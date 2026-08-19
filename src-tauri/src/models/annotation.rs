use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationProject {
    pub version: u32,
    pub capture_id: String,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub objects: Vec<AnnotationObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AnnotationObject {
    Arrow {
        id: String,
        start_x: f64,
        start_y: f64,
        end_x: f64,
        end_y: f64,
        color: String,
        stroke_width: f64,
    },
    Rect {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        color: String,
        stroke_width: f64,
        fill_color: Option<String>,
        border_radius: Option<f64>,
    },
    Ellipse {
        id: String,
        x: f64,
        y: f64,
        radius_x: f64,
        radius_y: f64,
        color: String,
        stroke_width: f64,
        fill_color: Option<String>,
    },
    Line {
        id: String,
        start_x: f64,
        start_y: f64,
        end_x: f64,
        end_y: f64,
        color: String,
        stroke_width: f64,
    },
    Text {
        id: String,
        x: f64,
        y: f64,
        text: String,
        font_size: f64,
        color: String,
        bg_color: Option<String>,
    },
    Highlight {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        color: String,
        opacity: f64,
    },
    Blur {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        blur_radius: f64,
    },
    Pixelate {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        block_size: f64,
    },
    StepBadge {
        id: String,
        x: f64,
        y: f64,
        number: u32,
        color: String,
        text_color: String,
        radius: f64,
    },
}
