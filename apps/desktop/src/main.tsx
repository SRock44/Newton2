// The desktop (Tauri) entry point — just triggers bootstrap.tsx's actual mount logic.
// Kept as its own file (rather than inlining into bootstrap.tsx) so apps/web's entry
// point can import the exact same bootstrap without pulling in anything Tauri-build-
// specific that might one day live only in this file.
import "./bootstrap";
