# Raw Capture and Replay App

This standalone app records reusable real-person validation data without running the rPPG pipeline during acquisition. It captures one continuous camera video, synchronized Polar H10 samples, protocol events, and sync markers. Later revisions to the shared rPPG algorithm can be evaluated by replaying the saved video, avoiding repeated participant collection for every algorithm change.

## Run

From the repository root:

```powershell
node capture\server.js
```

Then open:

```text
http://localhost:3000
```

If port `3000` is already in use, run with another port:

```powershell
$env:PORT=3001; node capture\server.js
```

## Capture Workflow

1. Enter a de-identified participant ID.
2. Click `Create Session`.
3. Connect a real Polar H10 or click `Simulate Polar`.
4. Click `Start Camera`.
5. Click `Start Full Capture`.

The app records the full protocol as one continuous `video.webm`:

- calibration
- 3-minute baseline
- 3-minute high-knee march
- 30-second active recovery
- recalibration
- 5-second steady delay
- 3-minute recovery

The capture app intentionally does not compute rPPG during acquisition.

## Saved Files

Sessions are saved under:

```text
capture/data/sessions/<session_id>/
```

Each capture session includes:

- `video.webm`
- `recording_manifest.json`
- `polar_hr_1hz.csv`
- `polar_rr.csv`
- `events.csv`
- `sync_markers.csv`

`capture/data/` is ignored by git because recorded videos are identifiable research data.

## Replay

Open:

```text
http://localhost:3000/replay.html
```

Enter a saved `session_id`, load the session, and run replay. Replay uses the shared algorithm modules in:

```text
shared/algorithm/
```

Replay outputs are saved under:

```text
capture/data/sessions/<session_id>/replays/<replay_id>/
```

Replay files include:

- `replay_manifest.json`
- `rppg_hr_1hz.csv`
- `interval_summary.csv`
- `rppg_debug.csv`
- `rppg_roi_candidates.csv`
- `rppg_signal_quality.csv`
- `cwt_power_diagnostics.csv`

The replay manifest records the algorithm manifest and shared source hashes so results can be traced to the exact rPPG implementation used.

## Notes

- Future rPPG revisions should be made in `shared/algorithm/`, not copied into individual apps.
- The original and simplified workflows import the same shared rPPG/ROI modules.
- Use a modern Chrome or Edge browser for Web Bluetooth and `MediaRecorder` support.
