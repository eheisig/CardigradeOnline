extends Node
class_name BoardManager

const CARD_SCENE = preload("res://Card.tscn")
@onready var hand_pivot = $HandPivot

var hand_cards: Array[Node] = []
var max_hand_width = 800.0

func _ready():
	print("Board ready! Press SPACEBAR to spawn random cards into the hand!")

func _input(event):
	if event is InputEventKey and event.pressed and event.keycode == KEY_SPACE:
		spawn_random_card()

func spawn_random_card():
	# FILTER: only spawn cards that have beautiful art!
	var valid_keys = []
	for card in CardDatabase.CARDS:
		if card.get("art_path", "") != "":
			valid_keys.append(card.id)
			
	if valid_keys.size() == 0:
		print("No cards with art found!")
		return
		
	var random_id = valid_keys[randi() % valid_keys.size()]
	
	var card = CARD_SCENE.instantiate()
	card.card_id = random_id
	
	# Connect our new specific play signal!
	card.play_requested.connect(_on_card_played.bind(card))
	
	hand_pivot.add_child(card)
	hand_cards.append(card)
	
	# Initial spawn off screen
	card.position = Vector2(800, 400)
	card.scale = Vector2(0.1, 0.1)
	
	update_hand_layout()

func _on_card_played(card: Node):
	if card in hand_cards:
		hand_cards.erase(card)
	card.is_played = true
	# Snap the played card onto the table
	var tween = create_tween().set_parallel(true)
	tween.tween_property(card, "rotation", 0.0, 0.2)
	tween.tween_property(card, "scale", Vector2(1,1), 0.2)
	update_hand_layout()

func update_hand_layout():
	var card_count = hand_cards.size()
	if card_count == 0: return
	
	var base_spacing = 150.0
	var requested_width = (card_count - 1) * base_spacing
	var current_spacing = base_spacing
	
	if requested_width > max_hand_width:
		current_spacing = max_hand_width / float(card_count - 1)
		requested_width = max_hand_width
		
	var start_x = -(requested_width / 2.0)
	
	for i in range(card_count):
		var card = hand_cards[i]
		if card.is_played: continue # Ignore played cards
		
		# X displacement
		var target_x = start_x + (i * current_spacing)
		
		# Arc tracking
		var center_dist = 0.0
		if card_count > 1:
			center_dist = (float(i) / float(card_count - 1)) * 2.0 - 1.0
			
		var curve_drop = abs(center_dist) * abs(center_dist) * 60.0 
		var rot_deg = center_dist * 15.0
		
		card.default_position = Vector2(target_x, curve_drop)
		card.default_rotation = deg_to_rad(rot_deg)
		
		card.z_index = i
		
		if not card.is_dragging and not card.is_inspecting:
			var tween = create_tween().set_parallel(true)
			tween.tween_property(card, "position", card.default_position, 0.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			tween.tween_property(card, "rotation", card.default_rotation, 0.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			tween.tween_property(card, "scale", Vector2(1,1), 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
