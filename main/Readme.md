# rppg-h10-validation

Local bilingual main workflow for validating webcam rPPG heartbeat-count estimates against Polar H10 1 Hz Heart Rate Service data during HCT trials.

## Run

```powershell
node main/server.js
```

Open:

```text
http://localhost:3000
```

Use Chrome or Edge for Web Bluetooth. The app can also generate simulated Polar samples for dry-run testing.

## Workflow

1. Enter a de-identified participant ID.
2. Start the session.
3. Connect Polar H10, or use simulated Polar data for testing.
4. Start the camera and wait for rPPG signal lock.
5. Run the baseline, exercise, 40-second active cool-down, 20-second pre-recovery buffer, and recovery protocol.
6. Click **Save Session**.

## Output

The server writes data under `main/data/`:

- `main/data/participants_summary.csv`: one row per participant/session.
- `main/data/sessions/<session_id>/polar_hr_1hz.csv`
- `main/data/sessions/<session_id>/rppg_hr_1hz.csv`
- `main/data/sessions/<session_id>/rppg_raw_signal.csv`
- `main/data/sessions/<session_id>/upper_face_rppg_hr_1hz.csv`
- `main/data/sessions/<session_id>/upper_face_rppg_raw_signal.csv`
- `main/data/sessions/<session_id>/events.csv`
- `main/data/sessions/<session_id>/trial_summary.csv`
- `main/data/sessions/<session_id>/session.json`

## Notes

- Event markers are app-side synchronized markers. They are not written into the Polar H10 device.
- Polar ground-truth heartbeat counts are computed by integrating the 1 Hz Polar HR samples over each trial window.
- rPPG trial metrics are derived during session finalization from continuous raw and 1 Hz rPPG streams; the live workflow does not pause at trial end to compute them.
- Agreement indexes are computed from beat counts at trial, phase, and session level. The raw 1 Hz rPPG files begin after signal lock and continue through camera-facing ready, practice, trial, intertrial, and recalibration-buffer states for audit/debugging.

See [Methodology.md](Methodology.md) for the full validation workflow and analysis methodology.
