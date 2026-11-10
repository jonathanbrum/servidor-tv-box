#!/bin/bash
# /lib/systemd/system-shutdown/spindown-hdd.sh
# Hook de desligamento executado pelo systemd-shutdown no último milissegundo antes de congelar a CPU.
# Garante que o HD Seagate pare os motores (spindown) APÓS o armbian-ramlog descarregar os logs no disco!

case "$1" in
    poweroff|halt)
        /usr/sbin/hdparm -y /dev/sda 2>/dev/null || true
        /bin/sleep 2
        ;;
esac
