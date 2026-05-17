# Simplified rPPG x Polar H10 Validation

Standalone simplified workflow for validating webcam rPPG pipelines against Polar H10 ground truth.

## Run

From this folder:

```powershell
node server.js
```

Open:

```text
http://localhost:3000
```

Use Chrome or Edge for Web Bluetooth. Simulated Polar samples are available for dry-run testing.

## Workflow

1. Create a de-identified participant session.
2. Connect Polar H10 or start simulated Polar data.
3. Start the camera and wait for initial rPPG signal lock.
4. Measure baseline HR for 3 minutes.
5. Run progressive high-knee marching for 3 minutes.
6. Run active recovery for 30 seconds.
7. Recalibrate until rPPG signal lock returns.
8. Measure recovery HR for 3 minutes.
9. Save the session.

Baseline and recovery are each split into six 30-second intervals. Every interval records CWT, LS, and Polar heartbeat-count estimates.

## Output

The server writes data under `simplified/data/`:

- `participants_summary.csv`
- `sessions/<session_id>/polar_hr_1hz.csv`
- `sessions/<session_id>/rppg_hr_1hz.csv`
- `sessions/<session_id>/rppg_debug.csv`
- `sessions/<session_id>/rppg_raw_signal.csv`
- `sessions/<session_id>/events.csv`
- `sessions/<session_id>/interval_summary.csv`
- `sessions/<session_id>/session.json`

`rppg_debug.csv` records per-second CWT quality diagnostics and interval-count peak diagnostics. `rppg_raw_signal.csv` records frame-level RGB/ROI timing rows and resampled POS rows so CWT artifacts can be traced back to the input signal.
