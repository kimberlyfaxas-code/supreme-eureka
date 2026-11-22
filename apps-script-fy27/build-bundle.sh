#!/bin/sh
# Regenerates dist/FY27All.gs (single-file install for Apps Script). Run from apps-script-fy27/.
python3 - <<'PY'
parts=["FY27Config.gs","FY27Engine.gs","FY27Build.gs","FY27Backtest.gs"]
out=["/* FY27 forecast build: ALL-IN-ONE FILE (generated from FY27Config.gs + FY27Engine.gs + FY27Build.gs + FY27Backtest.gs).\n * Install: delete every other file in the Apps Script project, then paste this into ONE file. Do not keep the individual files.\n */\n"]
for p in parts:
    out.append("\n/* ======================= %s ======================= */\n" % p)
    out.append(open(p).read())
open('dist/FY27All.gs','w').write("".join(out))
PY
