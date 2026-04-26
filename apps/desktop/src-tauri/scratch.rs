use ffmpeg_sidecar::command::FfmpegCommand; fn main() { let mut child = FfmpegCommand::new().spawn().unwrap(); let out = child.into_inner().wait_with_output(); }
use ffmpeg_sidecar::command::FfmpegCommand; fn main() { let mut cmd = FfmpegCommand::new(); let std_cmd: &mut std::process::Command = cmd.as_inner_mut(); }
