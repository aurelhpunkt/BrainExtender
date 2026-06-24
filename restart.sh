#!/bin/bash

echo "======================================"
echo " BrainExtender - Neustart Script"
echo "======================================"
echo ""

# Prüfe auf laufenden Server auf Port 3030 und beende ihn
echo "Suche nach alten Server-Prozessen auf Port 3030..."
PID=$(lsof -t -i:3030)

if [ -n "$PID" ]; then
  echo "Alter Server gefunden (PID: $PID). Wird beendet..."
  kill -9 $PID
  sleep 1
  echo "✓ Alter Server erfolgreich beendet."
else
  echo "✓ Kein alter Server gefunden. Port ist frei."
fi

echo ""
echo "Starte neuen Server..."
echo "======================================"
# Starte den Server (dieser Befehl blockiert das Terminal, damit du die Logs siehst)
node server.js
