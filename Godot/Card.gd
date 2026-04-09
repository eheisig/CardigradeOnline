extends Control
class_name CardUI

signal play_requested()

@export var card_id: String = "astrograde"
var card_data: Dictionary = {}

var is_hovered: bool = false
var is_inspecting: bool = false
var is_played: bool = false

var default_scale := Vector2(1, 1)
var hover_scale := Vector2(1.1, 1.1)
var default_position := Vector2.ZERO
var default_rotation := 0.0

@onready var play_btn = $PlayBtn

func _ready():
	pivot_offset = size / 2
	mouse_entered.connect(_on_mouse_entered)
	mouse_exited.connect(_on_mouse_exited)
	gui_input.connect(_on_gui_input)
	
	play_btn.hide()
	play_btn.modulate.a = 0
	play_btn.position.y = 0
	play_btn.pressed.connect(_on_play_btn_pressed)
	
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
		
	if is_hovered:
		scale = scale.lerp(hover_scale, 15 * delta)
		var mouse_pos = get_local_mouse_position()
		var center = size / 2
		var distance = mouse_pos - center
		position = position.lerp(default_position + (distance * 0.1), 10 * delta)

func _on_mouse_entered():
	if is_played or is_inspecting: return
	is_hovered = true
	z_index = 100 
	
	var tween = create_tween()
	tween.tween_property(self, "rotation", 0.0, 0.15).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)

func _on_mouse_exited():
	if not is_hovered or is_inspecting: return
	is_hovered = false
	_animate_back_to_hand()

func _on_gui_input(event):
	if event is InputEventMouseButton and event.button_index == MouseButton.MOUSE_BUTTON_LEFT and event.pressed:
		if is_inspecting:
			is_inspecting = false
			_animate_back_to_hand()
		elif not is_played:
			if get_parent():
				for sibling in get_parent().get_children():
					if sibling is CardUI and sibling != self and sibling.is_inspecting:
						sibling.is_inspecting = false
						sibling._animate_back_to_hand()
			
			is_inspecting = true
			_animate_to_inspect()

func _animate_back_to_hand():
	z_index = get_index()
	var tween = create_tween().set_parallel(true)
	tween.tween_property(self, "position", default_position, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "rotation", default_rotation, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "scale", default_scale, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	
	# Retract Play Arrow
	if play_btn.visible:
		tween.tween_property(play_btn, "position:y", 0.0, 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
		tween.tween_property(play_btn, "modulate:a", 0.0, 0.1)
		tween.chain().tween_callback(play_btn.hide)

func _animate_to_inspect():
	z_index = 300
	var vp_size = get_viewport_rect().size
	var target_scale = hover_scale * 1.5
	var target_global = (vp_size / 2.0) - ((size * target_scale) / 2.0)
	
	var tween = create_tween().set_parallel(true)
	tween.tween_property(self, "global_position", target_global, 0.3).set_trans(Tween.TRANS_QUINT).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "rotation", 0.0, 0.3).set_trans(Tween.TRANS_QUINT).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "scale", target_scale, 0.3).set_trans(Tween.TRANS_QUINT).set_ease(Tween.EASE_OUT)
	
	# Deploy Play Arrow
	play_btn.show()
	tween.tween_property(play_btn, "position:y", -80.0, 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT).set_delay(0.1)
	tween.tween_property(play_btn, "modulate:a", 1.0, 0.2).set_delay(0.1)
	
func _on_play_btn_pressed():
	if is_inspecting and not is_played:
		is_inspecting = false
		play_btn.hide()
		play_requested.emit()

func reject_play():
	is_played = false
	is_inspecting = false
	_animate_back_to_hand()

