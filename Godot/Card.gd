extends Control
class_name CardUI

signal play_requested()

@export var card_id: String = "astrograde"
var card_data: Dictionary = {}

var is_hovered: bool = false
var is_dragging: bool = false
var is_inspecting: bool = false
var is_played: bool = false

var drag_start_pos := Vector2.ZERO
var default_scale := Vector2(1, 1)
var hover_scale := Vector2(1.1, 1.1)
var default_position := Vector2.ZERO
var default_rotation := 0.0

func _ready():
	pivot_offset = size / 2
	mouse_entered.connect(_on_mouse_entered)
	mouse_exited.connect(_on_mouse_exited)
	gui_input.connect(_on_gui_input)
	default_position = position
	default_rotation = rotation
	load_card_data()

func load_card_data():
	card_data = CardDatabase.get_card(card_id)
	if card_data.is_empty():
		return
		
	var art_path = card_data.get("art_path", "")
	if art_path != "":
		var tex = load(art_path)
		if tex:
			$ArtRect.texture = tex
			$ArtRect.show()
			$Background.hide() 
			return
			
	$ArtRect.hide()
	$Background.show()
	if has_node("Background/VBox/Name"): $Background/VBox/Name.text = card_data.get("name", "")
	if has_node("Background/VBox/Emoji"): $Background/VBox/Emoji.text = card_data.get("emoji", "")
	if has_node("Background/VBox/Stats/Power"): $Background/VBox/Stats/Power.text = str(card_data.get("power", 0)) + " ⚔"
	if has_node("Background/VBox/Stats/Health"): $Background/VBox/Stats/Health.text = "❤ " + str(card_data.get("health", 0))

func _process(delta):
	if is_played or is_inspecting:
		return
		
	if is_dragging:
		# Manual drag coordinate override
		var target_pos = get_global_mouse_position() - ((size * scale) / 2.0)
		global_position = global_position.lerp(target_pos, 25 * delta)
		rotation = lerp_angle(rotation, 0.0, 15 * delta) # Flatten while dragged!
	elif is_hovered:
		# 3D Tilt calculation
		scale = scale.lerp(hover_scale, 15 * delta)
		var mouse_pos = get_local_mouse_position()
		var center = size / 2
		var distance = mouse_pos - center
		position = position.lerp(default_position + (distance * 0.1), 10 * delta)

func _on_mouse_entered():
	if is_played or is_inspecting or is_dragging: return
	is_hovered = true
	z_index = 100 
	
	# Flatten the arc rotation to zero so it sits upright in your hand
	var tween = create_tween()
	tween.tween_property(self, "rotation", 0.0, 0.15).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)

func _on_mouse_exited():
	if not is_hovered or is_inspecting or is_dragging: return
	is_hovered = false
	_animate_back_to_hand()

func _on_gui_input(event):
	if event is InputEventMouseButton and event.button_index == MouseButton.MOUSE_BUTTON_LEFT:
		if event.pressed:
			if is_inspecting:
				# Dismiss the inspect modal mode
				is_inspecting = false
				_animate_back_to_hand()
			elif not is_played:
				# Pick up the card for drag or inspect
				is_dragging = true
				drag_start_pos = global_position
				z_index = 200 # Slam to the very front
				var tween = create_tween()
				tween.tween_property(self, "scale", hover_scale * 0.9, 0.05)
		else: # Released Mouse!
			if is_dragging:
				is_dragging = false
				var dist_moved = global_position.distance_to(drag_start_pos)
				
				if dist_moved < 10.0:
					# Minimal movement = simple tap click! Trigger Inspect.
					is_inspecting = true
					_animate_to_inspect()
				else:
					# We dragged! Check if we dragged it high enough to 'Play'
					var vp_size = get_viewport_rect().size
					if global_position.y < (vp_size.y - 450): # Threshold line
						play_requested.emit()
					else:
						# Dragged and dropped back down in the hand
						_animate_back_to_hand()

func _animate_back_to_hand():
	z_index = get_index()
	var tween = create_tween().set_parallel(true)
	tween.tween_property(self, "position", default_position, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "rotation", default_rotation, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "scale", default_scale, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)

func _animate_to_inspect():
	z_index = 300
	var vp_size = get_viewport_rect().size
	var target_scale = hover_scale * 1.5
	# Calculate global position to dead center of screen
	var target_global = (vp_size / 2.0) - ((size * target_scale) / 2.0)
	
	var tween = create_tween().set_parallel(true)
	tween.tween_property(self, "global_position", target_global, 0.3).set_trans(Tween.TRANS_QUINT).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "rotation", 0.0, 0.3).set_trans(Tween.TRANS_QUINT).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "scale", target_scale, 0.3).set_trans(Tween.TRANS_QUINT).set_ease(Tween.EASE_OUT)
