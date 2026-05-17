# rHCT rPPG Workflows

This workspace contains three local workflows:

- `main/`: participant HCT heartbeat-counting validation against Polar H10.
- `simplified/`: continuous baseline/recovery interval validation.
- `capture/`: raw video capture and replay analysis.

Shared algorithm and server utilities live in `shared/` and `src/`.

Run the main workflow:

```powershell
node main/server.js
```

Run the test suite:

```powershell
node tests/run-tests.js
```
