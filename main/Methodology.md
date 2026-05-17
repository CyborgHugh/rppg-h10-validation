# rPPG x Polar H10 Validation App Methodology

## Purpose

This app validates webcam-based rPPG heart-rate estimates against Polar H10 heart-rate measurements during the HCT protocol. It is designed for participant-level and aggregated validation of the CWT and Lomb-Scargle rPPG pipelines during two analysis phases:

- **Baseline:** resting heartbeat-counting trials.
- **Recovery:** heartbeat-counting trials after high-knee marching and cool-down.

The Polar H10 stream is treated as the reference signal for v1. The app uses the standard Bluetooth Heart Rate Service at 1 Hz, including RR intervals when the device provides them. It does not write custom markers into the Polar H10 device; instead, it records synchronized app-side event markers on the same clock as the Polar and rPPG samples.

## App Workflow

1. The researcher enters a de-identified participant ID and starts a local session.
2. The browser connects to Polar H10 through Web Bluetooth, or the researcher can use simulated Polar samples for dry-run testing.
3. The participant starts the camera and waits until the rPPG signal is locked.
4. The app runs the HCT protocol:
   - 15-second practice trial.
   - Three randomized baseline trials of 30, 45, and 60 seconds.
   - Three-minute high-knee march at 80, 96, 112, and 124 SPM.
   - 40-second active cool-down at 80 SPM.
   - Pre-recovery rPPG recalibration after the participant sits down and faces the camera.
   - 20-second pre-recovery buffering after rPPG lock is restored.
   - Six 30-second recovery trials.
5. The app records event markers for session, camera, rPPG lock, trial hints, trial starts, trial ends, participant submissions, phase starts/ends, exercise start, pace changes, aborts, and session finish.
6. The researcher saves the session. The server writes raw data, trial summaries, and one aggregated participant-level row.

## Data Outputs

The server stores all output under `data/`, which is ignored by git.

Per session:

- `polar_hr_1hz.csv`: Polar HR samples with `sessionId`, `participantId`, wall-clock time, `performance.now()` time, BPM, and RR intervals as JSON.
- `rppg_hr_1hz.csv`: primary forehead+cheeks rPPG CWT/LS dynamic HR estimates with timestamps and phase labels. Rows begin after rPPG lock and continue across calibration-ready, practice, baseline, intertrial, pre-recovery buffering, recovery, and trial-recalibration countdown states while the participant faces the camera.
- `rppg_raw_signal.csv`: primary forehead+cheeks raw and processed rPPG diagnostic samples.
- `upper_face_rppg_hr_1hz.csv`: upper-face ROI CWT/LS dynamic HR estimates.
- `upper_face_rppg_raw_signal.csv`: upper-face ROI raw and processed rPPG diagnostic samples.
- `events.csv`: synchronized app-side event markers.
- `trial_summary.csv`: trial-level subjective beats, Polar beats, primary ROI beat estimates, upper-face ROI beat estimates, Madan interval estimates, and beat-count agreement indexes.
- `session.json`: complete raw session payload and computed summary.

Across sessions:

- `participants_summary.csv`: one row per participant/session, including trial count, trial metrics JSON, and beat-count agreement indexes for baseline, recovery, and total session scopes.

## Trial-Level Methodology

For each formal baseline and recovery trial, the analysis uses the `trial_start` and `trial_end` event markers as the authoritative counting window. Participant submission time is recorded as a separate event and does not extend the physiological trial window. The browser does not compute trial rPPG estimates when the trial ends; it keeps the camera/rPPG stream running and the server derives trial metrics during session finalization.

Polar heartbeat count is computed by integrating the 1 Hz Polar HR series over the trial window:

```text
Polar beats = sum(hr_bpm / 60 * delta_seconds)
```

CWT and LS heartbeat counts are derived from the saved continuous rPPG streams. The primary ROI is forehead+cheeks. A parallel upper-face ROI pipeline is recorded for comparison using the same trial windows.

- **CWT:** counts peaks from the CWT-reconstructed trial signal.
- **LS:** averages Lomb-Scargle HR estimates during the trial and converts HR to beats.

For each rPPG estimate, the app reports:

- Signed error.
- Absolute error.
- Percent error.
- Absolute percent error.
- Alignment index: `1 - absolute_error / Polar beats`.
- Inconsistency index: `absolute_error / Polar beats`.

The Polar-derived heartbeat count is the ground-truth denominator for percent-based trial deviations.

## Beat-Count Agreement Methodology

The main validation indexes are computed from heartbeat counts, not per-second HR agreement. The app computes alignment and inconsistency indexes at three scopes:

- Trial level: each formal baseline and recovery trial.
- Phase level: all baseline trials and all recovery trials separately.
- Session level: all formal baseline and recovery trials combined.

The app still stores 1 Hz rPPG and Polar HR streams so researchers can audit signal behavior, but those streams are not the primary agreement summary.

## rPPG Continuity and Recalibration

After initial calibration lock, the main workflow starts recording 1 Hz rPPG estimates immediately and keeps the rPPG stream running continuously across calibration-ready time, practice, baseline trials, subjective-count prompts, and intertrial intervals. Trial counts are extracted during session finalization from timestamped trial windows rather than by resetting the pipeline or running trial analysis in the live workflow.

The pipeline is reset only:

- Before recovery, after high-knee marching and active cool-down, once the participant sits down and faces the camera.
- After sustained face absence or signal interruption during a formal trial.

During pre-recovery recalibration, the countdown remains at `--` until face presence and rPPG lock return. After lock, 1 Hz rPPG estimates resume immediately during the 20-second buffer countdown, then recovery trial 1 begins. If a formal trial is interrupted, that trial attempt is aborted, logged, recalibrated, and restarted with the same trial number.

## Current Implementation Coverage

The current version realizes the v1 validation plan well:

- Local server and browser app are implemented without external npm dependencies.
- English/Chinese language switching is implemented in one shared app.
- Polar H10 Web Bluetooth support is implemented for the Heart Rate Service.
- Simulated Polar input is available for dry-run testing.
- App-side event synchronization is implemented.
- Raw Polar HR, raw rPPG HR, event logs, trial summaries, and participant aggregation are implemented.
- Trial-level, phase-level, and session-level beat-count validation indexes are implemented and covered by tests.

Remaining validation depends on hardware:

- A real Polar H10 connection must be manually tested in Chrome or Edge.
- Camera/rPPG acquisition must be manually tested under study lighting and participant-motion conditions.
- This v1 uses Polar's 1 Hz Heart Rate Service as the reference stream. If raw ECG-waveform validation is required later, the app should be extended to use Polar's ECG streaming capability and a dedicated ECG R-peak detection pipeline.
