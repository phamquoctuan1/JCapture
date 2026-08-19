use rusqlite::{params, Connection, Result};
use std::path::Path;
use std::sync::Mutex;
use crate::models::CaptureRecord;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &Path) -> Result<Self, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

        // Enable WAL mode for better concurrency and write speed
        let _ = conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS captures (
                id TEXT PRIMARY KEY,
                capture_type TEXT NOT NULL,
                original_path TEXT NOT NULL,
                thumbnail_path TEXT NOT NULL,
                project_path TEXT,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                monitor_id TEXT,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                is_closed INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_opened_at INTEGER
            )",
            [],
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at DESC)",
            [],
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_captures_pinned ON captures(is_pinned, is_closed)",
            [],
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        ).map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert_capture(&self, record: &CaptureRecord) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO captures (
                id, capture_type, original_path, thumbnail_path, project_path,
                width, height, monitor_id, is_pinned, is_closed,
                created_at, updated_at, last_opened_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                record.id,
                record.capture_type,
                record.original_path,
                record.thumbnail_path,
                record.project_path,
                record.width,
                record.height,
                record.monitor_id,
                record.is_pinned as i32,
                record.is_closed as i32,
                record.created_at,
                record.updated_at,
                record.last_opened_at,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_recent_captures(&self, limit: i64) -> Result<Vec<CaptureRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, capture_type, original_path, thumbnail_path, project_path,
                    width, height, monitor_id, is_pinned, is_closed,
                    created_at, updated_at, last_opened_at
             FROM captures
             WHERE is_closed = 0
             ORDER BY is_pinned DESC, created_at DESC
             LIMIT ?1"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![limit], |row| {
            Ok(CaptureRecord {
                id: row.get(0)?,
                capture_type: row.get(1)?,
                original_path: row.get(2)?,
                thumbnail_path: row.get(3)?,
                project_path: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                monitor_id: row.get(7)?,
                is_pinned: row.get::<_, i32>(8)? != 0,
                is_closed: row.get::<_, i32>(9)? != 0,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                last_opened_at: row.get(12)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for r in rows {
            if let Ok(rec) = r {
                results.push(rec);
            }
        }
        Ok(results)
    }

    pub fn toggle_pin(&self, id: &str, is_pinned: bool) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE captures SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![is_pinned as i32, chrono::Utc::now().timestamp_millis(), id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn close_capture(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE captures SET is_closed = 1, updated_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().timestamp_millis(), id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_capture(&self, id: &str) -> Result<Option<(String, String, Option<String>)>, String> {
        let conn = self.conn.lock().unwrap();
        let paths: Result<(String, String, Option<String>), _> = conn.query_row(
            "SELECT original_path, thumbnail_path, project_path FROM captures WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        );

        if let Ok((orig, thumb, proj)) = paths {
            conn.execute("DELETE FROM captures WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
            Ok(Some((orig, thumb, proj)))
        } else {
            Ok(None)
        }
    }

    pub fn update_project_path(&self, id: &str, project_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE captures SET project_path = ?1, updated_at = ?2 WHERE id = ?3",
            params![project_path, chrono::Utc::now().timestamp_millis(), id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_capture_image(&self, id: &str, width: u32, height: u32) -> Result<Option<(String, String)>, String> {
        let conn = self.conn.lock().unwrap();
        let paths: Result<(String, String), _> = conn.query_row(
            "SELECT original_path, thumbnail_path FROM captures WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );

        if let Ok((orig, thumb)) = paths {
            conn.execute(
                "UPDATE captures SET width = ?1, height = ?2, updated_at = ?3 WHERE id = ?4",
                params![width, height, chrono::Utc::now().timestamp_millis(), id],
            ).map_err(|e| e.to_string())?;
            Ok(Some((orig, thumb)))
        } else {
            Ok(None)
        }
    }

    pub fn get_capture_by_id(&self, id: &str) -> Result<Option<CaptureRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, capture_type, original_path, thumbnail_path, project_path,
                    width, height, monitor_id, is_pinned, is_closed,
                    created_at, updated_at, last_opened_at
             FROM captures
             WHERE id = ?1"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query_map(params![id], |row| {
            Ok(CaptureRecord {
                id: row.get(0)?,
                capture_type: row.get(1)?,
                original_path: row.get(2)?,
                thumbnail_path: row.get(3)?,
                project_path: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                monitor_id: row.get(7)?,
                is_pinned: row.get::<_, i32>(8)? != 0,
                is_closed: row.get::<_, i32>(9)? != 0,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                last_opened_at: row.get(12)?,
            })
        }).map_err(|e| e.to_string())?;

        if let Some(r) = rows.next() {
            r.map(Some).map_err(|e| e.to_string())
        } else {
            Ok(None)
        }
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}
