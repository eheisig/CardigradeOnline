extends Control
class_name BoardManager

const CARD_SCENE = preload("res://Card.tscn")
@onready var hand_pivot = $HandPivot

var state = {
	"player": {
		"deck": [],
		"hand": [], 
		"field": [], 
		"energy": 0,
		"max_energy": 1,
		"bonus_energy": 0
	},
	"opponent": {
		"deck": [],
		"hand": [],
		"field": [],
		"energy": 0,
		"max_energy": 1,
		"bonus_energy": 0
	},
	"turn": 1,
	"active_p": 0 
}

var max_hand_width = 1400.0
var targeting_card: Node = null

func _ready():
	if has_node("UI/EndTurnBtn"): $UI/EndTurnBtn.pressed.connect(_on_end_turn_pressed)
	start_game()

func start_game():
	state.player.deck = _generate_deck()
	state.player.deck.shuffle()
	state.opponent.deck = _generate_deck()
	state.turn = 1
	state.active_p = 0
	
	# Initial deal
	draw_cards(0, 3)
	
	var dummy = CARD_SCENE.instantiate()
	dummy.card_id = "guardigrade"
	dummy.is_played = true
	add_child(dummy)
	state.opponent.field.append(dummy)
	dummy.scale = Vector2(0.6, 0.6)
	dummy.position = Vector2(700, 200)
	
	start_turn()

func _generate_deck() -> Array:
	var deck = []
	var valid_keys = []
	for card in CardDatabase.CARDS:
		if card.get("art_path", "") != "":
			valid_keys.append(card.id)
			
	for i in range(10): # Simulate a 10 deck
		if valid_keys.size() > 0:
			deck.append(valid_keys[randi() % valid_keys.size()])
	return deck

func draw_cards(p_idx: int, count: int):
	var p = state.player if p_idx == 0 else state.opponent
	for i in range(count):
		if p.deck.size() > 0:
			var id = p.deck.pop_back()
			if p_idx == 0:
				_spawn_visual_card_in_hand(id)

func start_turn():
	var p = state.player if state.active_p == 0 else state.opponent
	
	# Refill Energy (caps at 4 usually based on turn number in original game)
	var base = min(4, state.turn)
	p.max_energy = base
	p.energy = base + p.bonus_energy
	if state.active_p == 0:
		p.bonus_energy = 0 # reset
	
	draw_cards(state.active_p, 1)
	update_ui()

func _on_end_turn_pressed():
	if state.active_p != 0: return
	
	# End player turn, immediately sim opponent turn for now
	state.active_p = 1
	start_turn()
	print("Opponent Turn Simulated")
	
	await get_tree().create_timer(1.0).timeout
	state.active_p = 0
	state.turn += 1
	start_turn()

func _spawn_visual_card_in_hand(id: String):
	var card = CARD_SCENE.instantiate()
	card.card_id = id
	card.play_requested.connect(_on_card_played.bind(card))
	card.attack_started.connect(_on_card_attack_started.bind(card))
	
	hand_pivot.add_child(card)
	state.player.hand.append(card)
	
	card.position = Vector2(800, 1000)
	card.scale = Vector2(0.1, 0.1)
	
	update_layout()

func _on_card_played(card: Node):
	if state.active_p != 0: 
		card.reject_play()
		return
		
	# Validate Cost
	var cost = card.card_data.get("cost", 0)
	if state.player.energy < cost:
		print("Not enough energy!")
		card.reject_play()
		return
		
	if state.player.field.size() >= 5:
		print("Field is full!")
		card.reject_play()
		return

	# Succeed!
	state.player.energy -= cost
	if card in state.player.hand:
		state.player.hand.erase(card)
	
	state.player.field.append(card)
	card.is_played = true
	
	# Snap the played card into position
	var tween = create_tween().set_parallel(true)
	tween.tween_property(card, "rotation", 0.0, 0.2)
	tween.tween_property(card, "scale", Vector2(0.6, 0.6), 0.2) # scale down for board
	tween.tween_property(card, "z_index", 10, 0.1)
	
	update_ui()
	update_layout()

func update_ui():
	if has_node("UI/PlayerEnergy"):
		$UI/PlayerEnergy.text = "Energy: " + str(state.player.energy) + " / " + str(state.player.max_energy)

func update_layout():
	_layout_hand()
	_layout_field()

func _layout_field():
	var count = state.player.field.size()
	if count == 0: return
	
	var spacing = 260.0
	var total_w = (count - 1) * spacing
	var start_x = -(total_w / 2.0)
	
	for i in range(count):
		var card = state.player.field[i]
		var target = Vector2(start_x + (i * spacing), -500.0) # Up on the field
		
		# Let card store position just in case
		card.default_position = target
		card.default_rotation = 0.0
		
		var tween = create_tween().set_parallel(true)
		tween.tween_property(card, "position", target, 0.3).set_trans(Tween.TRANS_QUINT).set_ease(Tween.EASE_OUT)

func _layout_hand():
	var hand = state.player.hand
	var card_count = hand.size()
	if card_count == 0: return
	
	var base_spacing = 150.0
	var requested_width = (card_count - 1) * base_spacing
	var current_spacing = base_spacing
	
	if requested_width > max_hand_width:
		current_spacing = max_hand_width / float(card_count - 1)
		requested_width = max_hand_width
		
	var start_x = -(requested_width / 2.0)
	
	for i in range(card_count):
		var card = hand[i]
		var target_x = start_x + (i * current_spacing)
		
		var center_dist = 0.0
		if card_count > 1:
			center_dist = (float(i) / float(card_count - 1)) * 2.0 - 1.0
			
		var curve_drop = abs(center_dist) * abs(center_dist) * 60.0 
		var rot_deg = center_dist * 15.0
		
		card.default_position = Vector2(target_x, curve_drop)
		card.default_rotation = deg_to_rad(rot_deg)
		card.z_index = i
		
		if not card.is_inspecting:
			var tween = create_tween().set_parallel(true)
			tween.tween_property(card, "position", card.default_position, 0.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			tween.tween_property(card, "rotation", card.default_rotation, 0.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			tween.tween_property(card, "scale", Vector2(1,1), 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

func _on_card_attack_started(card: Node):
	if state.active_p != 0: return
	targeting_card = card
	if has_node("TargetArrow"): $TargetArrow.show()

func _process(_delta):
	if targeting_card and has_node("TargetArrow"):
		var start = targeting_card.global_position + ((targeting_card.size * targeting_card.scale) / 2.0)
		$TargetArrow.points = PackedVector2Array([start, get_local_mouse_position()])

func _input(event):
	if targeting_card:
		if event is InputEventMouseButton and not event.pressed and event.button_index == MouseButton.MOUSE_BUTTON_LEFT:
			_resolve_attack(event.global_position)
			targeting_card = null
			if has_node("TargetArrow"): $TargetArrow.hide()

func _resolve_attack(pos: Vector2):
	var hit_card = null
	for o_card in state.opponent.field:
		if o_card.get_global_rect().has_point(pos):
			hit_card = o_card
			break
			
	if hit_card:
		print("CLASH! ", targeting_card.card_data.name, " attacks ", hit_card.card_data.name)
		
		var ap = targeting_card.card_data.power
		var op = hit_card.card_data.power
		
		targeting_card.card_data.health -= op
		hit_card.card_data.health -= ap
		
		targeting_card.load_card_data()
		hit_card.load_card_data()
		
		if "exhausted" in targeting_card.card_data:
			targeting_card.card_data.exhausted = true
		
		if targeting_card.card_data.health <= 0:
			state.player.field.erase(targeting_card)
			targeting_card.queue_free()
		
		if hit_card.card_data.health <= 0:
			state.opponent.field.erase(hit_card)
			hit_card.queue_free()
			
		update_layout()
		
	elif has_node("UI/OpponentBlock") and $UI/OpponentBlock.get_global_rect().has_point(pos):
		print("DIRECT ATTACK TO OPPONENT BLOCK!")
		# TODO: remove UI block
		if "exhausted" in targeting_card.card_data:
			targeting_card.card_data.exhausted = true
	else:
		print("Attack cancelled.")
