let _uid = 0;
const uid = () => ++_uid;

function makeDeck() {
  return CARDS.flatMap(def => [makeInst(def), makeInst(def)]);
}
function makeInst(def) {
  return { ...def, iid: uid(), curPow: def.power, curHp: def.health, maxHp: def.health,
    exhausted: false, usedAbility: false };
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// ===== GAME STATE =====
let G = null; // game state
let UIState = { action: 'idle', selectedCard: null, selectedFrom: null }; // action: idle|selectAttacker|selectTarget|selectFriendlyTarget|selectBlockSwap
let pendingEffect = null; // callback waiting for target
let hoverCard = null;

function initGameState(p1, p2) {
  const d1 = shuffle(makeDeck()), d2 = shuffle(makeDeck());
  return {
    players: [
      { name:p1, deck:d1.slice(6), hand:d1.slice(3,6), field:[], blockCards:d1.slice(0,3),
        energy:0, maxEnergy:1, bonusEnergy:0, extraDraw:0, hasMossColony:false },
      { name:p2, deck:d2.slice(6), hand:d2.slice(3,6), field:[], blockCards:d2.slice(0,3),
        energy:0, maxEnergy:1, bonusEnergy:0, extraDraw:0, hasMossColony:false },
    ],
    turn: 1,
    activeP: 0,
    phase: 'main', // main | end
    log: [],
    winner: null,
  };
}

function ap() { return G.players[G.activeP]; }
function op() { return G.players[1-G.activeP]; }
function apIdx() { return G.activeP; }
function opIdx() { return 1-G.activeP; }

// ===== LOG =====
function log(msg, cls='') {
  G.log.push({ msg, cls });
  if (G.log.length > 40) G.log.shift();
}

// ===== DRAW =====
function drawCard(pIdx, count=1, toBlock=false) {
  const p = G.players[pIdx];
  const drawn = [];
  for (let i=0; i<count; i++) {
    if (p.deck.length === 0) { log(`${p.name} has no cards to draw!`, 'bad'); break; }
    const card = p.deck.pop();
    if (toBlock) {
      p.blockCards.push(card);
      log(`${p.name} added a card to BLOCK.`, 'good');
    } else {
      p.hand.push(card);
      drawn.push(card);
      log(`${p.name} drew ${card.name}.`);
    }
  }
  // Moss Colony passive
  if (!toBlock && p.hasMossColony) {
    drawn.forEach(c => {
      if (c.type === 'cardigrade') {
        log(`[Moss Colony] Drawing again!`, 'good');
        drawCard(pIdx, 1);
      }
    });
  }
}

// ===== ENERGY =====
function getMaxEnergyForTurn(turnNum) {
  return Math.min(4, turnNum);
}
function refillEnergy(pIdx) {
  const p = G.players[pIdx];
  const base = getMaxEnergyForTurn(G.turn);
  p.energy = base + p.bonusEnergy;
  p.bonusEnergy = 0;
  p.maxEnergy = base;
}

// ===== PASSIVE CHECK =====
function applyPassives(pIdx) {
  const p = G.players[pIdx];
  p.hasMossColony = p.field.some(c => c.id === 'mosscolony');
  const hasRegolith = p.field.some(c => c.id === 'regolith');
  if (hasRegolith) {
    p.field.forEach(c => { if (c.type === 'cardigrade' && c.id !== 'regolith') c.curPow = Math.max(4, c.curPow); });
  }
}

// ===== DISCARD CARD =====
function discardFromField(pIdx, cardIdx, silent=false) {
  const p = G.players[pIdx];
  const card = p.field[cardIdx];
  if (!card) return null;
  if (card.isProtected && card.curHp > 0) {
    if (!silent) log(`${card.name} cannot be discarded! (Mr Clean)`, 'bad');
    return null;
  }
  p.field.splice(cardIdx, 1);
  if (!silent) log(`${card.name} was discarded.`, 'bad');
  // Death effects
  if (card.id === 'martyrgrade') {
    log(`[The Large Leap] ${p.name} draws 2!`, 'good');
    drawCard(pIdx, 2);
  }
  if (card.id === 'cargograde') {
    log(`[Caboose] Cargograde shuffles back into deck!`, 'good');
    p.deck.unshift(card);
    shuffle(p.deck);
  }
  applyPassives(pIdx);
  return card;
}

// ===== PLAY CARD =====
function canPlayCard(card, pIdx) {
  const p = G.players[pIdx];
  if (p.energy < card.cost) return false;
  if (p.field.length >= 5) return false;
  if (card.isVault) {
    if (!p.field.some(c => c.id === 'cargograde')) return false;
    if (p.blockCards.length === 0) return false;
  }
  if (card.id === 'tardigreat' && p.field.length === 0) return false;
  return true;
}

function playCard(handIdx) {
  const p = ap();
  const card = p.hand[handIdx];
  if (!card) return;
  if (!canPlayCard(card, apIdx())) { showToast('Cannot play that card!'); return; }

  p.hand.splice(handIdx, 1);
  p.energy -= card.cost;
  log(`${p.name} plays ${card.name}!`, 'highlight');

  // Special play requirements
  if (card.isVault) {
    p.blockCards.pop(); // spend a block card
    log(`${card.name} consumed a BLOCK card to enter play.`, 'bad');
  }

  // Tardigreat: must discard an active
  if (card.id === 'tardigreat') {
    const inst = { ...card, iid: uid(), curPow: card.power, curHp: card.health, maxHp: card.health, exhausted: false };
    p.field.push(inst);
    applyPassives(apIdx());
    // Choose field card to discard
    pendingEffect = (tIdx) => {
      discardFromField(apIdx(), tIdx);
      log(`[Massive Ego] Sacrificed a Cardigrade!`, 'bad');
      render(); setAction('idle');
    };
    setAction('selectFriendlyTarget', 'Select a Cardigrade to sacrifice for Tardigreat.');
    render(); return;
  }

  // Hypnosporum: steal enemy, discard self
  if (card.id === 'hypnosporum') {
    const enemies = op().field.filter(c => c.curHp <= 4);
    if (enemies.length === 0) {
      log(`No eligible enemies to steal! Hypnosporum fizzles.`, 'bad');
    } else {
      pendingEffect = (tIdx) => {
        const stolen = op().field.splice(tIdx, 1)[0];
        stolen.exhausted = true;
        ap().field.push(stolen);
        log(`[The Feast] Stole ${stolen.name}!`, 'good');
        applyPassives(apIdx()); applyPassives(opIdx());
        render(); setAction('idle');
      };
      setAction('selectEnemyTarget', 'Select enemy Cardigrade to steal (≤4 health).');
      render(); return;
    }
    render(); return;
  }

  // Tardibabe: play another cardigrade for free
  if (card.id === 'tardibabe') {
    p.field.push({ ...card, iid: uid(), curPow: card.power, curHp: card.health, maxHp: card.health, exhausted: true });
    applyPassives(apIdx());
    const cardigs = p.hand.filter(c => c.type === 'cardigrade');
    if (cardigs.length > 0) {
      pendingEffect = (hIdx) => {
        const c2 = p.hand[hIdx];
        p.hand.splice(hIdx, 1);
        p.field.push({ ...c2, iid: uid(), curPow: c2.power, curHp: c2.health, maxHp: c2.health, exhausted: true });
        log(`[Allure] Played ${c2.name} for free!`, 'good');
        applyPassives(apIdx());
        triggerPlayEffect(c2, null);
        render(); setAction('idle');
      };
      setAction('selectHandCard', 'Select a Cardigrade from your hand to play for free (Allure).');
      render(); return;
    }
    render(); return;
  }

  // Place on field
  const inst = { ...card, iid: card.iid||uid(), curPow: card.power, curHp: card.health, maxHp: card.health, exhausted: true };
  p.field.push(inst);
  applyPassives(apIdx());

  triggerPlayEffect(card, inst);
  render();
}

function triggerPlayEffect(card, inst) {
  const p = ap();
  if (card.id === 'astrograde') {
    p.bonusEnergy += 1;
    log(`[To the Moon] Next turn gains +1 energy!`, 'good');
  } else if (card.id === 'guardigrade') {
    drawCard(apIdx(), 2, true);
    log(`[Shield of Faith] Drew 2 BLOCK cards!`, 'good');
  } else if (card.id === 'artigrade') {
    const gained = p.field.reduce((s,c) => s + c.curPow, 0);
    p.energy += gained;
    log(`[Water Paints] Gained ${gained} energy!`, 'good');
  } else if (card.id === 'crudegrade') {
    pendingEffect = (tIdx) => {
      const target = ap().field[tIdx];
      if (target) { target.curPow=2; target.curHp=Math.min(target.curHp,2); target.maxHp=Math.max(target.maxHp,2);
        log(`[Muddle] Set ${target.name} to 2/2.`, 'bad'); }
      render(); setAction('idle');
    };
    setAction('selectAnyTarget', 'Select any Cardigrade to set to 2/2 (Muddle).');
    return;
  } else if (card.id === 'tardijade') {
    if (p.field.length > 1) {
      pendingEffect = (tIdx) => {
        const t = ap().field[tIdx];
        if (t && t.iid !== (inst?.iid)) { t.curPow += 2; log(`[Soil Eater] Gave +2/+0 to ${t.name}!`, 'good'); }
        render(); setAction('idle');
      };
      setAction('selectFriendlyTarget', 'Select a friendly Cardigrade to give +2/+0 (Soil Eater).');
      return;
    }
  } else if (card.id === 'tardislayed') {
    if (p.field.length > 1) {
      pendingEffect = (tIdx) => {
        const t = ap().field[tIdx];
        if (t && t.iid !== (inst?.iid)) { t.curPow+=2; t.curHp+=2; t.maxHp+=2; log(`[Handbag] Gave +2/+2 to ${t.name}!`, 'good'); }
        render(); setAction('idle');
      };
      setAction('selectFriendlyTarget', 'Select a friendly Cardigrade to give +2/+2 (Handbag).');
      return;
    }
  }
}

// ===== ACTIVE ABILITIES =====
function useActiveAbility(fieldIdx) {
  const p = ap();
  const card = p.field[fieldIdx];
  if (!card || !card.hasActive) return;
  if (card.usedAbility) { showToast('Already used this turn!'); return; }
  if (p.energy < (card.activeCost||0)) { showToast('Not enough energy!'); return; }

  if (card.id === 'drbeach') {
    if (p.field.length < 2) { showToast('Need another Cardigrade on field!'); return; }
    pendingEffect = (tIdx) => {
      const t = ap().field[tIdx];
      if (t) { t.curPow+=1; t.curHp+=1; t.maxHp+=1;
        log(`[Starship Navigator] ${t.name} gets +1/+1!`, 'good'); }
      ap().energy -= card.activeCost||0;
      card.usedAbility = true;
      render(); setAction('idle');
    };
    setAction('selectFriendlyTarget', 'Select a friendly Cardigrade to buff +1/+1 (Starship Navigator).');
    return;
  }
  if (card.id === 'drstclair') {
    if (p.field.length < 2) { showToast('Need another Cardigrade to sacrifice!'); return; }
    pendingEffect = (tIdx) => {
      const t = ap().field[tIdx];
      if (!t || t.iid === card.iid) return;
      const had4plus = t.curPow >= 4 || t.curHp >= 4;
      discardFromField(apIdx(), tIdx);
      log(`[Terraforming] Discarded ${t.name}.`, 'bad');
      if (had4plus) {
        if (op().blockCards.length > 0) {
          op().blockCards.pop();
          log(`[Terraforming] Enemy consumed a BLOCK card!`, 'good');
          checkWin();
        }
      }
      ap().energy -= card.activeCost||0;
      card.usedAbility = true;
      render(); setAction('idle');
    };
    setAction('selectFriendlyTarget', 'Select a Cardigrade to discard (Terraforming).');
    return;
  }
  if (card.id === 'cargograde') {
    if (p.hand.length === 0 || p.blockCards.length === 0) { showToast('Need cards in hand and blocks!'); return; }
    // Show modal to pick hand card to swap
    showModal('Caboose', 'Select a hand card to send to BLOCK (you get the block card in hand).',
      p.hand.map((c,i) => ({ label: `${c.emoji} ${c.name}`, val: i })),
      (hIdx) => {
        const handCard = p.hand.splice(hIdx, 1)[0];
        const blockCard = p.blockCards.pop();
        p.blockCards.push(handCard);
        p.hand.push(blockCard);
        log(`[Caboose] Swapped ${handCard.name} to BLOCK, got ${blockCard.name}.`, 'good');
        card.usedAbility = true;
        render();
      }
    );
    return;
  }
}

// ===== ATTACK =====
function canAttack(card) {
  return !card.exhausted && card.curPow > 0;
}

function enterAttackMode() {
  if (G.turn === 1) { showToast('Cannot attack on turn 1!'); return; }
  setAction('selectAttacker', 'Select a Cardigrade to attack with.');
}

function doAttack(attackerIdx, targetType, targetIdx) {
  const atk = ap().field[attackerIdx];
  if (!atk) return;
  atk.exhausted = true;

  const oField = op().field;

  if (targetType === 'field') {
    const def = oField[targetIdx];
    if (!def) return;
    log(`${atk.name} (${atk.curPow}⚔) attacks ${def.name} (${def.curHp}❤)!`, 'highlight');

    const atkDmg = atk.curPow;
    const defDmg = def.curPow;

    // Apply damage
    def.curHp -= atkDmg;
    if (!atk.isProtected) atk.curHp -= defDmg; else atk.curHp = Math.max(1, atk.curHp - defDmg);
    if (atk.curHp <= 0) {
      if (atk.isProtected) { atk.curHp = 1; }
    }

    // Check deaths
    let atkDied = false, defDied = false;
    if (def.curHp <= 0) {
      log(`${def.name} was destroyed!`, 'bad');
      // Cartigrade / Tardipaid kill effects
      if (atk.id === 'cartigrade') {
        if (op().blockCards.length > 0) { op().blockCards.pop(); log(`[RAM] Enemy lost a BLOCK card!`, 'good'); checkWin(); }
      }
      if (atk.id === 'tardipaid') {
        ap().energy += 1; log(`[Embezzle] Gained 1 energy!`, 'good');
      }
      oField.splice(targetIdx, 1);
      if (def.id === 'martyrgrade') { drawCard(opIdx(), 2); log(`[The Large Leap] ${op().name} drew 2!`, ''); }
      if (def.id === 'cargograde') { op().deck.unshift({...def}); log(`[Caboose] Cargograde shuffled into deck!`, ''); }
      defDied = true;
    }
    if (atk.curHp <= 0 && !atk.isProtected) {
      log(`${atk.name} was also destroyed!`, 'bad');
      ap().field.splice(attackerIdx, 1);
      if (atk.id === 'martyrgrade') { drawCard(apIdx(), 2); log(`[The Large Leap] ${ap().name} drew 2!`, 'good'); }
      if (atk.id === 'cargograde') { ap().deck.unshift({...atk}); log(`[Caboose] Cargograde shuffled into deck!`, 'good'); }
      atkDied = true;
    }
    applyPassives(apIdx()); applyPassives(opIdx());
  } else if (targetType === 'player') {
    // Direct attack
    if (oField.length > 0) {
      // Check Yung Grady exception
      const onlyGrady = oField.length === 1 && oField[0].id === 'yunggrady' && oField[0].curHp === 1;
      if (!onlyGrady) { showToast('Cannot attack player while enemy has Cardigrades!'); return; }
    }
    log(`${atk.name} attacks ${op().name} directly!`, 'highlight');
    if (atk.curPow < 1) { log(`${atk.name} has 0 power, cannot deal blocks!`, 'bad'); return; }

    // Tardifate: remove extra blocks equal to power
    let blocksToRemove = 1;
    if (atk.id === 'tardifate') blocksToRemove = atk.curPow;
    // Tardifreight: remove 2 blocks
    if (atk.id === 'tardifreight') blocksToRemove = 2;

    if (op().blockCards.length === 0) {
      log(`${op().name} has no blocks! ${ap().name} WINS!`, 'highlight');
      G.winner = apIdx();
      showGameOver();
      return;
    }

    for (let i = 0; i < blocksToRemove; i++) {
      if (op().blockCards.length === 0) break;
      const blockCard = op().blockCards.pop();
      log(`${op().name} flips BLOCK: ${blockCard.name}!`, '');
      applyBlockEffect(blockCard, opIdx());
    }
    checkWin();
  }
  applyPassives(apIdx()); applyPassives(opIdx());
  render();
}

// ===== BLOCK EFFECTS =====
function applyBlockEffect(card, pIdx) {
  const p = G.players[pIdx];
  log(`[BLOCK] ${card.name}: ${card.blockText}`, 'good');

  switch(card.id) {
    case 'astrograde': // Summon with no cost
      p.field.push({ ...card, iid: uid(), curPow: card.power, curHp: card.health, maxHp: card.health, exhausted: true });
      log(`${card.name} entered the field for free!`, 'good');
      applyPassives(pIdx); break;
    case 'drbeach': case 'drstclair': case 'cargograde': case 'yunggrady': // Add to hand
      p.hand.push({ ...card, iid: uid(), curPow: card.power, curHp: card.health, maxHp: card.health, exhausted: false });
      log(`${card.name} added to hand!`, 'good'); break;
    case 'guardigrade': // Shuffle in, draw, add to block
      p.deck.unshift({ ...card, iid: uid(), curPow: card.power, curHp: card.health, maxHp: card.health });
      shuffle(p.deck);
      drawCard(pIdx, 1, true);
      log(`Guardigrade shuffled in, drew a block card!`, 'good'); break;
    case 'hypnosporum': case 'tardibabe': case 'tardifate': // Play for free
      p.field.push({ ...card, iid: uid(), curPow: card.power, curHp: card.health, maxHp: card.health, exhausted: true });
      log(`${card.name} played for free from block!`, 'good');
      applyPassives(pIdx); break;
    case 'tardigiant': case 'tardifreight': // Double block (already handled by slots)
      log(`${card.name} absorbed the hit as a 2-block!`, 'good'); break;
    case 'artigrade': // Draw 3, shuffle in
      drawCard(pIdx, 3);
      p.deck.unshift({ ...card, iid: uid(), curPow: card.power, curHp: card.health, maxHp: card.health });
      log(`Artigrade shuffled in, drew 3!`, 'good'); break;
    case 'martyrgrade': // Gain 1 energy
      p.energy += 1; log(`Gained 1 energy!`, 'good'); break;
    case 'regolith': // Give a tardigrade +4/0
      if (p.field.length > 0) { const t = p.field[0]; t.curPow += 4; log(`${t.name} got +4/+0!`, 'good'); } break;
    case 'mosscolony': // Pick from top 5, play free
      const top5 = p.deck.slice(-5).filter(c => c.type === 'cardigrade');
      if (top5.length > 0) {
        const pick = top5[Math.floor(Math.random()*top5.length)];
        const idx = p.deck.findLastIndex(c => c.iid === pick.iid);
        if (idx >= 0) p.deck.splice(idx,1);
        p.field.push({ ...pick, iid: uid(), curPow: pick.power, curHp: pick.health, maxHp: pick.health, exhausted: true });
        log(`[Go Forth!] ${pick.name} played from deck!`, 'good');
        applyPassives(pIdx);
      } break;
    case 'tardipaid': // Deal 3 to enemy
      const enemy = G.players[1-pIdx].field;
      if (enemy.length > 0) {
        const t = enemy[0]; t.curHp -= 3;
        log(`[Embezzle Block] ${t.name} took 3 damage!`, 'bad');
        if (t.curHp <= 0) { G.players[1-pIdx].field.splice(0,1); log(`${t.name} destroyed!`, 'bad'); }
        applyPassives(1-pIdx);
      } break;
    case 'tardislayed': // Give all +1/+1
      p.field.forEach(c => { c.curPow+=1; c.curHp+=1; c.maxHp+=1; });
      log(`All your Cardigrades got +1/+1!`, 'good'); break;
    case 'tarditrade': // Steal random enemy card
      const eHand = G.players[1-pIdx].hand;
      if (eHand.length > 0) {
        const si = Math.floor(Math.random()*eHand.length);
        const stolen = eHand.splice(si,1)[0];
        p.hand.push(stolen);
        log(`Stole ${stolen.name} from enemy hand!`, 'good');
      } break;
    case 'cartigrade': // Search deck, add to hand
      if (p.deck.length > 0) {
        const pick2 = p.deck.pop();
        p.hand.push(pick2);
        log(`[RAM Block] Found ${pick2.name} in deck!`, 'good');
      } break;
    default:
      log(`${card.name} block effect resolved.`, '');
  }
  applyPassives(pIdx);
}

// ===== WIN CHECK =====
function checkWin() {
  if (op().blockCards.length === 0 && op().field.length === 0) {
    // Can still win if opponent can be directly attacked
    // Actually win condition: "attack the other player when they have no block cards"
    // So we need to attack them first. Just check if they have 0 blocks.
  }
  if (G.winner !== null) return;
}

// ===== PLAY AS BLOCK =====
function playAsBlock(handIdx) {
  const p = ap();
  const card = p.hand[handIdx];
  if (!card) return;
  p.hand.splice(handIdx, 1);
  const slots = card.slots || 1;
  for (let i=0; i<slots; i++) p.blockCards.push({ ...card, iid: uid() });
  log(`${p.name} placed ${card.name} as a BLOCK card${slots>1?' (x'+slots+')':''}!`);
  render();
}

// ===== END TURN =====
function endTurn() {
  const p = ap();
  // Tarditrade: extra draw
  if (p.field.some(c => c.id === 'tarditrade')) {
    drawCard(apIdx(), 1);
    log(`[Shady Purchase] Drew an extra card!`, 'good');
  }
  // Reset exhaustion
  p.field.forEach(c => { c.exhausted = false; c.usedAbility = false; });
  // Switch player
  G.activeP = 1 - G.activeP;
  G.turn++;
  refillEnergy(G.activeP);
  drawCard(G.activeP, 1);
  log(`--- Turn ${G.turn}: ${ap().name}'s turn ---`, 'highlight');
  setAction('idle');
  render();
  // Show pass screen
  showPassScreen();
}

// ===== WIN =====
function showGameOver() {
  const el = document.getElementById('gameOver');
  el.classList.add('visible');
  document.getElementById('winnerText').textContent = `${G.players[G.winner].name} WINS!`;
  document.getElementById('winnerSub').textContent = `The opponent had no block cards remaining`;
}

// ===== UI ACTIONS =====
function setAction(action, hint='') {
  UIState.action = action;
  document.getElementById('actionHint').textContent = hint || getDefaultHint();
  document.getElementById('cancelBtn').style.display = (action !== 'idle') ? 'block' : 'none';
  document.getElementById('attackBtn').style.display = (action === 'idle') ? 'block' : 'none';
  document.getElementById('endTurnBtn').style.display = (action === 'idle') ? 'block' : 'none';
}
function getDefaultHint() { return `${ap().name}: select a card to play or click Attack`; }
function cancelAction() {
  pendingEffect = null;
  UIState.selectedCard = null;
  UIState.selectedFrom = null;
  setAction('idle');
  render();
}

// ===== MODAL =====
function showModal(title, desc, options, callback) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalDesc').textContent = desc;
  const opts = document.getElementById('modalOptions');
  opts.innerHTML = '';
  options.forEach(opt => {
    const div = document.createElement('div');
    div.className = 'modal-option';
    div.innerHTML = `<span class="opt-emoji">${opt.label.split(' ')[0]}</span><span>${opt.label.split(' ').slice(1).join(' ')}</span>`;
    div.onclick = () => { closeModal(); callback(opt.val); };
    opts.appendChild(div);
  });
  document.getElementById('modal').classList.add('visible');
}
function closeModal() { document.getElementById('modal').classList.remove('visible'); }

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(() => { t.className = 'toast hide'; setTimeout(() => t.className = 'toast', 300); }, 1500);
}

// ===== PASS SCREEN =====
function showPassScreen() {
  document.getElementById('game').classList.remove('visible');
  const ps = document.getElementById('passScreen');
  ps.classList.add('visible');
  document.getElementById('passTitle').textContent = `${ap().name.toUpperCase()}'S TURN`;
  document.getElementById('passSubtitle').textContent = `Pass the device to ${ap().name}`;
}
function revealGame() {
  document.getElementById('passScreen').classList.remove('visible');
  document.getElementById('game').classList.add('visible');
  render();
}

// ===== RENDER =====
function render() {
  if (!G) return;
  const active = ap(), opp = op();
  const aIdx = apIdx(), oIdx = opIdx();

  // Header
  document.getElementById('turnInfo').textContent = `TURN ${G.turn}`;
  document.getElementById('phaseInfo').textContent = `${active.name.toUpperCase()}'S TURN`;

  // Names
  document.getElementById('activeName').textContent = active.name;
  document.getElementById('oppName').textContent = opp.name;

  // Energy
  renderEnergy('activeEnergy', active.energy, Math.max(active.maxEnergy, active.energy));
  renderEnergy('oppEnergy', opp.energy, opp.maxEnergy);

  // Blocks
  document.getElementById('activeBlocks').textContent = `🔵 ${active.blockCards.length} BLOCK${active.blockCards.length!==1?'S':''}`;
  document.getElementById('oppBlocks').textContent = `🔵 ${opp.blockCards.length} BLOCK${opp.blockCards.length!==1?'S':''}`;

  // Decks
  document.getElementById('activeDeck').textContent = `📚 ${active.deck.length}`;
  document.getElementById('oppDeck').textContent = `📚 ${opp.deck.length}`;

  // Active player field
  renderField('activeField', active.field, 'active', aIdx);
  // Opponent field
  renderField('oppField', opp.field, 'opp', oIdx);
  // Active hand
  renderHand('activeHand', active.hand, 'active');
  // Opponent hand (face down)
  renderHand('oppHand', opp.hand, 'opp');

  // Empty slot hints handled in renderField

  // Buttons
  document.getElementById('attackBtn').style.display = UIState.action === 'idle' ? 'block' : 'none';
  document.getElementById('endTurnBtn').style.display = UIState.action === 'idle' ? 'block' : 'none';
  document.getElementById('cancelBtn').style.display = UIState.action !== 'idle' ? 'block' : 'none';
}

function renderEnergy(elId, cur, max) {
  const el = document.getElementById(elId);
  let html = '';
  const total = Math.max(max, cur, 4);
  for (let i=0; i<total; i++) html += `<div class="energy-pip${i<cur?' filled':''}"></div>`;
  html += `<span style="color:var(--gold);font-size:0.7rem;margin-left:3px">${cur}⚡</span>`;
  el.innerHTML = html;
}

function renderField(elId, field, side, pIdx) {
  const el = document.getElementById(elId);
  let html = '';
  if (field.length === 0) {
    if (side === 'opp') {
      html = `<span class="empty-slot" id="oppFieldEmpty">EMPTY FIELD</span>`;
    } else {
      html = `<span class="empty-slot" id="activeFieldEmpty">DROP CARDS HERE</span>`;
    }
  } else {
    field.forEach((card, i) => {
      const isSelected = UIState.selectedCard && UIState.selectedCard.iid === card.iid && UIState.selectedFrom === 'field';
      const isTarget = isTargetable(card, side, i, pIdx);
      const isFriendly = isFriendlyTargetable(card, side, i);
      let classes = 'card';
      if (isSelected) classes += ' selected';
      if (isTarget) classes += ' targetable';
      if (isFriendly) classes += ' friendly-target';
      if (card.exhausted) classes += ' exhausted';
      const hpColor = card.curHp <= 1 ? 'var(--red)' : card.curHp < card.maxHp ? 'var(--gold)' : 'var(--green)';
      html += `<div class="${classes}" onclick="onCardClick('field',${i},'${side}')" onmouseenter="showCardDetail(${i},'${side}')" onmouseleave="hideCardDetail()">
        <div class="card-inner">
          <div class="card-emoji">${card.emoji}</div>
          <div class="card-name">${card.name}</div>
          <div class="card-ability-name">${card.ability}</div>
          ${card.hasActive ? `<div style="font-size:0.5rem;color:var(--gold);text-align:center">[Active: ${card.activeCost}⚡]</div>` : ''}
          <div class="card-stats">
            <span class="stat-power">${card.curPow}⚔</span>
            <span class="stat-health" style="color:${hpColor}">${card.curHp}❤</span>
          </div>
        </div>
      </div>`;
    });
  }
  el.innerHTML = html;
}

function renderHand(elId, hand, side) {
  const el = document.getElementById(elId);
  let html = '';
  if (side === 'opp') {
    hand.forEach(() => { html += `<div class="card face-down"></div>`; });
  } else {
    hand.forEach((card, i) => {
      const p = ap();
      const canPlay = canPlayCard(card, apIdx());
      const isSelected = UIState.selectedCard && UIState.selectedCard.iid === card.iid && UIState.selectedFrom === 'hand';
      const isHandTarget = UIState.action === 'selectHandCard';
      let classes = 'card';
      if (isSelected) classes += ' selected';
      if (!canPlay && UIState.action === 'idle') classes += ' exhausted';
      if (isHandTarget && card.type === 'cardigrade') classes += ' friendly-target';
      html += `<div class="${classes}" onclick="onCardClick('hand',${i},'${side}')" onmouseenter="showCardDetailByCard(${i},'hand')" onmouseleave="hideCardDetail()">
        <div class="card-inner">
          <div class="card-emoji">${card.emoji}</div>
          <div class="card-name">${card.name}</div>
          <div class="card-ability-name">${card.ability}</div>
          <div class="card-stats">
            <span class="stat-power">${card.curPow}⚔</span>
            <span class="stat-health">${card.curHp}❤</span>
            <span class="stat-cost">${card.cost}⚡</span>
          </div>
          <div style="display:flex;gap:0.2rem;justify-content:center;padding-top:0.2rem;">
            ${canPlay && UIState.action==='idle' ? `<button class="btn btn-small" style="padding:0.2rem 0.3rem;font-size:0.5rem" onclick="event.stopPropagation();playCard(${i})">PLAY</button>` : ''}
            ${UIState.action==='idle' ? `<button class="btn btn-small" style="padding:0.2rem 0.3rem;font-size:0.5rem;border-color:var(--blue);color:var(--blue)" onclick="event.stopPropagation();playAsBlock(${i})">BLOCK</button>` : ''}
          </div>
        </div>
      </div>`;
    });
    if (hand.length === 0) html = `<div style="font-size:0.7rem;color:var(--text2);padding:0.5rem">No cards in hand</div>`;
  }
  el.innerHTML = html;
}

function isTargetable(card, side, idx, pIdx) {
  if (UIState.action === 'selectAttacker') return side === 'active' && !card.exhausted && card.curPow > 0;
  if (UIState.action === 'selectTarget' || UIState.action === 'selectEnemyTarget') return side === 'opp';
  if (UIState.action === 'selectAnyTarget') return true;
  return false;
}
function isFriendlyTargetable(card, side, idx) {
  if (UIState.action === 'selectFriendlyTarget') return side === 'active';
  return false;
}

function onCardClick(fromType, idx, side) {
  if (UIState.action === 'selectAttacker' && side === 'active' && fromType === 'field') {
    const card = ap().field[idx];
    if (!card || card.exhausted || card.curPow === 0) { showToast('That card cannot attack!'); return; }
    UIState.selectedCard = card;
    UIState.selectedCardIdx = idx;
    UIState.selectedFrom = 'field';
    // Check if can attack opponent directly
    const oField = op().field;
    const onlyGrady = oField.length === 1 && oField[0].id === 'yunggrady' && oField[0].curHp === 1;
    if (oField.length === 0 || onlyGrady) {
      setAction('selectTarget', `${card.name} selected. Click opponent field or click here to attack player!`);
    } else {
      setAction('selectTarget', `${card.name} selected. Click an enemy Cardigrade to attack!`);
    }
    render(); return;
  }
  if (UIState.action === 'selectTarget') {
    if (side === 'opp' && fromType === 'field') {
      doAttack(UIState.selectedCardIdx, 'field', idx);
      UIState.selectedCard = null; UIState.selectedCardIdx = null;
      setAction('idle'); render(); return;
    }
  }
  if (UIState.action === 'selectFriendlyTarget' && side === 'active' && fromType === 'field') {
    if (pendingEffect) {
      const fn = pendingEffect; pendingEffect = null;
      fn(idx); return;
    }
  }
  if (UIState.action === 'selectEnemyTarget' && side === 'opp' && fromType === 'field') {
    if (pendingEffect) {
      const fn = pendingEffect; pendingEffect = null;
      fn(idx); return;
    }
  }
  if (UIState.action === 'selectAnyTarget' && fromType === 'field') {
    if (pendingEffect) {
      const localIdx = side === 'opp' ? ap().field.length + idx : idx; // encode side
      // Actually pass idx and side to pendingEffect differently
      if (side === 'active' && pendingEffect) { const fn = pendingEffect; pendingEffect = null; fn(idx); return; }
      if (side === 'opp' && pendingEffect) {
        // For Crudegrade targeting enemy
        const fn = pendingEffect; pendingEffect = null;
        // Rebuild with enemy context: temporarily patch to work
        const target = op().field[idx];
        if (target) { target.curPow=2; target.curHp=Math.min(target.curHp,2); target.maxHp=Math.max(target.maxHp,2);
          log(`[Muddle] Set ${target.name} to 2/2.`, 'bad'); }
        render(); setAction('idle'); return;
      }
    }
  }
  if (UIState.action === 'selectHandCard' && side === 'active' && fromType === 'hand') {
    const card = ap().hand[idx];
    if (card && card.type === 'cardigrade' && pendingEffect) {
      const fn = pendingEffect; pendingEffect = null; fn(idx); return;
    }
  }
  // Active ability click on field
  if (UIState.action === 'idle' && side === 'active' && fromType === 'field') {
    const card = ap().field[idx];
    if (card && card.hasActive) {
      setAction('selectAttacker'); // temporarily
      useActiveAbility(idx);
    }
  }
}

// Click opponent area to attack player
function attackPlayer() {
  if (UIState.action === 'selectTarget') {
    const idx = UIState.selectedCardIdx;
    doAttack(idx, 'player', -1);
    UIState.selectedCard = null; UIState.selectedCardIdx = null;
    setAction('idle'); render();
  }
}

// ===== CARD DETAIL TOOLTIP =====
function showCardDetail(fieldIdx, side) {
  const card = side === 'active' ? ap().field[fieldIdx] : op().field[fieldIdx];
  if (!card) return;
  showCardDetailByObj(card);
}
function showCardDetailByCard(handIdx, fromType) {
  const card = fromType === 'hand' ? ap().hand[handIdx] : null;
  if (!card) return;
  showCardDetailByObj(card);
}
function showCardDetailByObj(card) {
  document.getElementById('cdName').textContent = `${card.emoji} ${card.name}`;
  document.getElementById('cdAbilityName').textContent = card.ability;
  document.getElementById('cdText').textContent = card.abilityText;
  document.getElementById('cdBlock').textContent = card.blockText;
  document.getElementById('cardDetail').style.display = 'block';
}
function hideCardDetail() {
  document.getElementById('cardDetail').style.display = 'none';
}

// ===== OPPONENT ZONE CLICK =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('oppZone').addEventListener('click', (e) => {
    if (!e.target.closest('.card') && UIState.action === 'selectTarget') {
      attackPlayer();
    }
  });
});

// ===== START GAME =====
function startGame() {
  const p1 = document.getElementById('p1Name').value || 'Player 1';
  const p2 = document.getElementById('p2Name').value || 'Player 2';
  G = initGameState(p1, p2);

  // Coin flip for first player
  G.activeP = Math.random() < 0.5 ? 0 : 1;
  refillEnergy(G.activeP);
  log(`Coin flip: ${ap().name} goes first!`, 'highlight');
  log(`--- Turn 1: ${ap().name}'s turn ---`, 'highlight');

  document.getElementById('setup').style.display = 'none';
  render();
  showPassScreen();
}
