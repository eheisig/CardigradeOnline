extends Control
class_name CardUI

@export var card_id: String = "astrograde"
var card_data: Dictionary = {}

var is_hovered: bool = false
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
	if has_node("Background/VBox/Name"):
		$Background/VBox/Name.text = card_data.get("name", "")
	if has_node("Background/VBox/Emoji"):
		$Background/VBox/Emoji.text = card_data.get("emoji", "")
	if has_node("Background/VBox/Stats/Power"):
		$Background/VBox/Stats/Power.text = str(card_data.get("power", 0)) + " ⚔"
	if has_node("Background/VBox/Stats/Health"):
		$Background/VBox/Stats/Health.text = "❤ " + str(card_data.get("health", 0))

func _process(delta):
	if is_hovered:
		scale = scale.lerp(hover_scale, 15 * delta)
		var mouse_pos = get_local_mouse_position()
		var center = size / 2
		var distance = mouse_pos - center
		var target_pos = default_position + (distance * 0.1)
		position = position.lerp(target_pos, 10 * delta)

func _on_mouse_entered():
	if is_hovered: return
	is_hovered = true
	z_index = 100 # Ensure it's above everything
	
	# Flatten the arc rotation so we can read it easily!
	var tween = create_tween()
	tween.tween_property(self, "rotation", 0.0, 0.15).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)

func _on_mouse_exited():
	if not is_hovered: return
	is_hovered = false
	z_index = get_index() # Reverts generally
	
	var tween = create_tween()
	tween.set_parallel(true)
	tween.tween_property(self, "scale", default_scale, 0.2).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "position", default_position, 0.2).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "rotation", default_rotation, 0.2).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)

func _on_gui_input(event):
	if event is InputEventMouseButton and event.pressed and event.button_index == MouseButton.MOUSE_BUTTON_LEFT:
		print("Played: ", card_data.get("name", "Unknown"))
		var tween = create_tween()
		tween.tween_property(self, "scale", hover_scale * 0.9, 0.05)
		tween.tween_property(self, "scale", hover_scale, 0.1).set_delay(0.05)
