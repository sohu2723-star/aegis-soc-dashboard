# Wi-Fi lab tools

These small scripts are for an isolated, authorized lab. They do not change
AP settings, disconnect clients, send wireless frames, or attempt to recover
Wi-Fi passwords.

The MT7601U adapter from this project is exposed as
`wlx1cbfce9caba1` in the example commands. Replace it if `iw dev` shows a
different interface name.

## 1. Check monitor mode

```bash
python3 scripts/src/wifi_lab_tools/monitor_mode_checker.py \
  wlx1cbfce9caba1
```

## 2. Passively inspect Wi-Fi

Metadata mode normally needs managed mode:

```bash
python3 scripts/src/wifi_lab_tools/passive_wifi_monitor.py \
  --interface wlx1cbfce9caba1 \
  --metadata
```

Frame mode needs monitor mode and may need root privileges:

```bash
sudo python3 scripts/src/wifi_lab_tools/passive_wifi_monitor.py \
  --interface wlx1cbfce9caba1 \
  --frames 30
```

The frame output is observational only. It contains wireless metadata, not a
plaintext Wi-Fi password.

## 3. Audit a password locally

The password is read using `getpass`, then discarded. It is not printed,
stored, or sent to a network:

```bash
python3 scripts/src/wifi_lab_tools/password_strength_auditor.py --confirm
```

The result is a heuristic estimate. A strong rating is not a guarantee.

## 4. Run the synthetic hash demonstration

```bash
python3 scripts/src/wifi_lab_tools/synthetic_hash_demo.py
```

This uses a fixed, in-memory dummy candidate set and SHA-256. It has no
wireless or network functionality and is only intended to explain the
candidate → hash → compare concept.
