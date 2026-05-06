# Dynamic Interoceptive Accuracy Task (HCT Variant) using rPPG

## 1. Overview and Aims

This protocol outlines an online experimental paradigm designed to measure interoceptive accuracy using the Heartbeat Counting Task (HCT) during both a resting baseline and an "activated state" (rapidly changing heart rate following physical exertion). 

By employing the HCT across both homeostatic and allostatic states, this protocol evaluates the precision weighting dynamics of interoceptive predictive processing under perturbation, while simultaneously stress-testing remote photoplethysmography (rPPG) algorithms.

## 2. Experimental Protocol

### Phase 1: Baseline Heartbeat Counting Task (Resting State)
*   **Objective:** Establish resting HCT performance.
*   **Procedure:**
    1.  **Calibration:** Participant aligns their face within an on-screen guide. 
    2.  **Instructions:** Detailed instructions explain how the HCT works. Participants are asked to count their heartbeats silently without taking their pulse.
    3.  **Practice Trial:** A single 15-second practice trial to familiarize the participant with the tones and UI.
    4.  **Formal Trials:** Three trials of varying durations (**30, 45, and 60 seconds**), presented in a randomized order.
        *   Each trial is separated by a **10-second Inter-Trial Interval (ITI)**.
        *   Each trial begins with a 3-second visual hint ("Focus on your heartbeats...").
        *   A start tone marks the beginning of the counting period.
        *   An end tone marks the end of the counting period.
        *   A prompt appears asking the participant to input their counted heartbeats.

### Phase 2: The Activated State (Exercise Manipulation)
*   **Objective:** Safely induce a significant cardiovascular response.
*   **Procedure:**
    1.  **Exercise (3 Minutes Total):** Knee-up march matching an animated visual guide and metronome.
        *   **0 - 30 seconds:** 80 Steps Per Minute (SPM).
        *   **30 - 60 seconds:** 96 SPM.
        *   **60 - 120 seconds:** 112 SPM. 
        *   **120 - 180 seconds:** 124 SPM. 

### Phase 3: Active Cool-Down (Safety Transition)
*   **Objective:** Prevent sudden venous pooling.
*   **Procedure:**
    1.  **Cool-down:** 30-second slower walk-in-place at **80 SPM**.

### Phase 4: Pre-Recovery Signal Buffering
*   **Objective:** Rebuild the rPPG signal buffer before recovery recording.
*   **Procedure:**
    1.  **Buffering:** A 10-second pause allows the camera to collect stable facial frames while the participant sits still.

### Phase 5: Recovery Heartbeat Counting Task
*   **Objective:** Measure interoceptive accuracy dynamically as heart rate decelerates.
*   **Procedure:**
    1.  **Trials:** Four trials, all with a fixed duration of **30 seconds**.
    2.  **Flow:** Similar to the baseline HCT. Each trial involves a 3-second hint, a start tone, 30 seconds of counting, an end tone, and a prompt for input.
    3.  **Timing & ITI:** The first trial begins immediately after the 10-second buffering phase. After the participant submits their count, a **10-second ITI** begins before the next trial.
    4.  **Timestamping:** Because participants require variable amounts of time to type and submit their answers, the timeline is dynamic. The exact timestamps (relative to the start of the recovery phase) for Trial Start, Trial End, and Submission are recorded.
    5.  **Data Quality Control:** During any active counting trial (Baseline or Recovery), if the camera loses track of the participant's face for more than 3 consecutive seconds, the trial is immediately aborted, an alert is displayed, and the specific trial restarts to ensure uncorrupted physiological extraction.

---

## 3. Data Extraction and Analysis

### rPPG Beat Extraction
Objective heartbeat counts for each trial are extracted via two optimized pipelines for comparison:
1.  **Optimized POS + CWT:** Uses Continuous Wavelet Transform (CWT) peak-finding across the trial window to explicitly count individual heartbeats.
2.  **Optimized POS + LS:** Averages the Lomb-Scargle (LS) estimated heart rate across the trial window, mathematically converted into a beat count (i.e., `(Average HR / 60) * Duration`).

### Interoceptive Accuracy Metrics
Standard HCT accuracy indices can be calculated for each trial:
$$IAc = 1 - \frac{| \text{Objective Beats} - \text{Subjective Beats} |}{\text{Objective Beats}}$$

By comparing the $IAc$ scores across the randomized baseline trials to the sequential recovery trials, researchers can model the decay of interoceptive precision as the physiological state returns to homeostasis.