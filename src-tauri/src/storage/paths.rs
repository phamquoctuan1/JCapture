use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root_dir: PathBuf,
    pub captures_dir: PathBuf,
    pub thumbnails_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub recordings_dir: PathBuf,
    pub db_path: PathBuf,
}

impl AppPaths {
    pub fn init() -> Result<Self, String> {
        let base_dir = dirs::data_local_dir()
            .ok_or_else(|| "Could not determine local data directory".to_string())?
            .join("JCapture");

        let captures_dir = base_dir.join("captures");
        let thumbnails_dir = base_dir.join("thumbnails");
        let projects_dir = base_dir.join("projects");
        let recordings_dir = base_dir.join("recordings");
        let db_dir = base_dir.join("database");
        let db_path = db_dir.join("jcapture.db");

        std::fs::create_dir_all(&captures_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&thumbnails_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;

        Ok(Self {
            root_dir: base_dir,
            captures_dir,
            thumbnails_dir,
            projects_dir,
            recordings_dir,
            db_path,
        })
    }
}
