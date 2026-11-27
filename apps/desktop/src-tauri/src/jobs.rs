use std::collections::HashMap;
use std::process::Child;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

/// Shared handle to a running FFmpeg job stored inside `JobRegistry`.
pub struct ActiveJob {
    pub cancelled: Arc<AtomicBool>,
    pub child: Arc<Mutex<Option<Child>>>,
}

/// Handles returned to the conversion worker thread upon job registration.
pub struct JobHandles {
    pub cancelled: Arc<AtomicBool>,
    pub child: Arc<Mutex<Option<Child>>>,
}

/// Thread-safe registry of running FFmpeg child processes enabling real
/// per-job cancellation and orphan-free application shutdown.
#[derive(Default)]
pub struct JobRegistry {
    jobs: Mutex<HashMap<String, ActiveJob>>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }

    /// Checks whether `job_id` is already registered as an active job.
    pub fn contains(&self, job_id: &str) -> bool {
        let guard = match self.jobs.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.contains_key(job_id)
    }

    /// Registers a spawned child process for `job_id`.
    /// Kills and reaps `child` if registration fails (e.g. duplicate `job_id`)
    /// so no orphan FFmpeg process is ever leaked.
    pub fn register(&self, job_id: String, mut child: Child) -> Result<JobHandles, String> {
        let mut guard = match self.jobs.lock() {
            Ok(g) => g,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Job registry lock poisoned".to_string());
            }
        };
        if guard.contains_key(&job_id) {
            drop(guard);
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Job '{job_id}' is already running"));
        }

        let cancelled = Arc::new(AtomicBool::new(false));
        let child_slot = Arc::new(Mutex::new(Some(child)));
        guard.insert(
            job_id,
            ActiveJob {
                cancelled: Arc::clone(&cancelled),
                child: Arc::clone(&child_slot),
            },
        );

        Ok(JobHandles {
            cancelled,
            child: child_slot,
        })
    }

    /// Signals cancellation and terminates the child process for `job_id`.
    /// Returns `true` if an active job was found.
    pub fn cancel(&self, job_id: &str) -> bool {
        let handles = {
            let guard = match self.jobs.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard
                .get(job_id)
                .map(|j| (Arc::clone(&j.cancelled), Arc::clone(&j.child)))
        };

        if let Some((cancelled, child_slot)) = handles {
            cancelled.store(true, Ordering::SeqCst);
            if let Ok(mut slot) = child_slot.lock() {
                if let Some(ref mut child) = *slot {
                    let _ = child.kill();
                }
            }
            true
        } else {
            false
        }
    }

    /// Removes `job_id` from the registry once the worker finishes draining output.
    pub fn remove(&self, job_id: &str) -> Option<ActiveJob> {
        let mut guard = match self.jobs.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.remove(job_id)
    }

    /// Terminates and reaps all active child processes (called on app exit / tray Quit).
    pub fn kill_all(&self) {
        let active: Vec<ActiveJob> = {
            let mut guard = match self.jobs.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard.drain().map(|(_, job)| job).collect()
        };

        for job in active {
            job.cancelled.store(true, Ordering::SeqCst);
            if let Ok(mut slot) = job.child.lock() {
                if let Some(mut child) = slot.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }

    /// Returns the number of currently registered active jobs.
    pub fn active_count(&self) -> usize {
        let guard = match self.jobs.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.len()
    }

    /// Checks whether a currently registered job has been flagged as cancelled.
    pub fn is_cancelled(&self, job_id: &str) -> bool {
        let guard = match self.jobs.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard
            .get(job_id)
            .map(|j| j.cancelled.load(Ordering::SeqCst))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::new_command;
    use std::process::Stdio;

    fn spawn_sleep_child() -> Child {
        #[cfg(target_os = "windows")]
        {
            new_command("cmd")
                .args(["/C", "ping -n 10 127.0.0.1 >NUL"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("failed to spawn test sleeper on windows")
        }
        #[cfg(not(target_os = "windows"))]
        {
            new_command("sleep")
                .arg("10")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("failed to spawn test sleeper on unix")
        }
    }

    #[test]
    fn register_cancel_and_cleanup_lifecycle() {
        let registry = JobRegistry::new();
        assert_eq!(registry.active_count(), 0);
        assert!(!registry.cancel("nonexistent"));

        let child = spawn_sleep_child();
        let handles = registry
            .register("job_test_1".into(), child)
            .expect("register should succeed");

        assert_eq!(registry.active_count(), 1);
        assert!(registry.contains("job_test_1"));
        assert!(!registry.is_cancelled("job_test_1"));
        assert!(!handles.cancelled.load(Ordering::SeqCst));

        // Duplicate registration must fail and kill/reap dup_child
        let dup_child = spawn_sleep_child();
        assert!(registry.register("job_test_1".into(), dup_child).is_err());

        // Cancel sets flag and kills process
        assert!(registry.cancel("job_test_1"));
        assert!(registry.is_cancelled("job_test_1"));
        assert!(handles.cancelled.load(Ordering::SeqCst));

        // Reap and remove
        let removed = registry.remove("job_test_1");
        assert!(removed.is_some());
        assert_eq!(registry.active_count(), 0);

        let maybe_child = handles.child.lock().unwrap().take();
        if let Some(mut c) = maybe_child {
            let _ = c.wait();
        }
    }

    #[test]
    fn kill_all_terminates_and_clears_all_jobs() {
        let registry = JobRegistry::new();
        let h1 = registry
            .register("job_a".into(), spawn_sleep_child())
            .expect("register job_a");
        let h2 = registry
            .register("job_b".into(), spawn_sleep_child())
            .expect("register job_b");

        assert_eq!(registry.active_count(), 2);
        registry.kill_all();

        assert_eq!(registry.active_count(), 0);
        assert!(h1.cancelled.load(Ordering::SeqCst));
        assert!(h2.cancelled.load(Ordering::SeqCst));
    }
}
