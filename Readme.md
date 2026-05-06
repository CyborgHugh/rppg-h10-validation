# rppg-h10-validation

Local bilingual web app for validating webcam rPPG heart-rate estimates against Polar H10 1 Hz Heart Rate Service data.

## Run

```powershell
node server.js
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
5. Run the baseline, exercise, cool-down, pre-recovery, and recovery protocol.
6. Click **Save Session**.

## Output

The server writes data under `data/`:

- `data/participants_summary.csv`: one row per participant/session.
- `data/sessions/<session_id>/polar_hr_1hz.csv`
- `data/sessions/<session_id>/rppg_hr_1hz.csv`
- `data/sessions/<session_id>/events.csv`
- `data/sessions/<session_id>/trial_summary.csv`
- `data/sessions/<session_id>/session.json`

## Notes

- Event markers are app-side synchronized markers. They are not written into the Polar H10 device.
- Polar ground-truth heartbeat counts are computed by integrating the 1 Hz Polar HR samples over each trial window.
- Dynamic baseline/recovery agreement metrics include MAE, RMSE, mean bias, MAPE, Pearson correlation, Lin's CCC, and Bland-Altman limits of agreement.
