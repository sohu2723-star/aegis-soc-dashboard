# AEGIS VM Setup Guide — aegis-forwarder (10.30.30.10)

> Script တစ်ခုတည်း (`aegis_forwarder.py --mode hub`) ကို AEGIS VM မှာ run ပြီး
> bank-web, customer-db, pfSense အကုန် cover လုပ်တယ်။

---

## အဆင့် 1 — ဟောင်းတွေ ဖြုတ်

```bash
# /opt/ ထဲက ဟောင်းတွေ အကုန်ဖြုတ်
sudo rm -rf /opt/aegis /opt/aegis_forwarder.py /opt/aegis_forwarder_hub.py

# verify
ls /opt/
```

---

## အဆင့် 2 — GitHub ကနေ latest script ဆွဲ

```bash
# /opt/aegis folder အသစ် လုပ်ပြီး repo clone
sudo git clone https://github.com/sohu2723-star/aegis-soc-dashboard.git /opt/aegis

# permission ပေး
sudo chown -R sithu:sithu /opt/aegis

# script folder သွား
cd /opt/aegis/scripts/src
ls
# မြင်ရမည်: aegis_forwarder.py  aegis_forwarder.local.conf.example
```

---

## အဆင့် 3 — Python dependency ထည့်

```bash
pip3 install requests
```

---

## အဆင့် 4 — Config ဖိုင် setup

```bash
cd /opt/aegis/scripts/src

# example ကို copy
cp aegis_forwarder.local.conf.example aegis_forwarder.local.conf

# ဖြည့်
nano aegis_forwarder.local.conf
```

ဖိုင်ထဲ ဒီ values ဖြည့်:

```ini
AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
AEGIS_KEY=<AEGIS_INGEST_KEY — Render မှာ သတ်မှတ်ထားတဲ့ key>
AEGIS_ADMIN_KEY=<AEGIS_ADMIN_KEY — Render မှာ သတ်မှတ်ထားတဲ့ key>

REMOTE_SSH_USER=sithu
PFSENSE_IP=10.30.30.1
PFSENSE_API_URL=http://10.30.30.1/api/v1
PFSENSE_API_KEY=<pfSense မှာ generate မယ့် token — မရသေးရင် blank ထား>

DEFENSE_POLL_SECS=5
VM_NAME=ubuntu
```

> `Ctrl+O` → `Enter` → `Ctrl+X` (save ပြီး ထွက်)

---

## အဆင့် 5 — SSH Key setup (bank-web + customer-db)

Hub mode က bank VMs တွေထဲ SSH ဝင်ပြီး log tail တယ် — password မပါဘဲ ဝင်နိုင်ဖို့:

```bash
# Key မရှိသေးရင် generate (ရှိပြီးသားဆိုရင် skip)
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# bank-web ထဲ key ကူး
ssh-copy-id sithu@10.10.10.10

# customer-db ထဲ key ကူး
ssh-copy-id sithu@10.20.20.20

# test
ssh -o BatchMode=yes sithu@10.10.10.10 echo "OK"
ssh -o BatchMode=yes sithu@10.20.20.20 echo "OK"
```

---

## အဆင့် 6 — bank-web / customer-db မှာ sudo iptables ခွင့်ပြု

Defense command (IP block) တွေ execute နိုင်ဖို့ bank VMs မှာ ဒါ လုပ်ပေး:

```bash
# bank-web မှာ SSH ဝင်ပြီး run (OR bank-web ကို SSH ဝင်ပြီး run)
ssh sithu@10.10.10.10
echo "sithu ALL=(root) NOPASSWD: /sbin/iptables" | sudo tee -a /etc/sudoers.d/aegis
exit

# customer-db မှာလည်း
ssh sithu@10.20.20.20
echo "sithu ALL=(root) NOPASSWD: /sbin/iptables" | sudo tee -a /etc/sudoers.d/aegis
exit
```

---

## အဆင့် 7 — Run!

```bash
cd /opt/aegis/scripts/src

# test run (foreground — Ctrl+C နှိပ်ရင် ရပ်)
python3 aegis_forwarder.py --mode hub
```

ထွက်လာမည့် output:

```
╔══════════════════════════════════════════════════════════════════╗
║            AEGIS Forwarder — Blue Team v3                        ║
╚══════════════════════════════════════════════════════════════════╝
  Target  : https://aegis-api-server-jp3b.onrender.com/api
  Mode    : hub  ← hub: covers bank-web, customer-db, pfSense

  [*] Registering host with AEGIS...
  ✓ Host registered: aegis-forwarder (10.30.30.10)
  ► defense_agent thread started (hub — covering [aegis, pfsense, bank-web, customer-db])

  Hub mode — remote hosts (2):
    bank-web        10.10.10.10  sensors=[suricata, snort, fail2ban, ssh, http, ftp]
    customer-db     10.20.20.20  sensors=[suricata, fail2ban, ssh, postgresql]
  pfSense API  : 10.30.30.1

  ► bank-web/suricata thread started
  ► bank-web/snort thread started
  ...
```

---

## Background service (systemd) — reboot ရင်လည်း auto start

```bash
sudo nano /etc/systemd/system/aegis-forwarder.service
```

ဖိုင်ထဲ ဒါ paste:

```ini
[Unit]
Description=AEGIS Forwarder Hub
After=network.target

[Service]
Type=simple
User=sithu
WorkingDirectory=/opt/aegis/scripts/src
ExecStart=/usr/bin/python3 /opt/aegis/scripts/src/aegis_forwarder.py --mode hub
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable aegis-forwarder
sudo systemctl start aegis-forwarder

# status ကြည့်
sudo systemctl status aegis-forwarder

# logs ကြည့်
sudo journalctl -u aegis-forwarder -f
```

---

## Script Update လုပ်ချင်ရင် (GitHub ကနေ latest ဆွဲ)

Replit မှာ code ပြောင်းပြီး push လိုက်ရင် — AEGIS VM မှာ ဒါပဲ run ရတယ်:

```bash
cd /opt/aegis

# latest ဆွဲ
git pull

# service restart
sudo systemctl restart aegis-forwarder

# confirm
sudo systemctl status aegis-forwarder
```

> **config ဖိုင် (`aegis_forwarder.local.conf`) ကို git pull လုပ်ရင် မထိဘူး** —
> gitignore ထားတဲ့ local file ဖြစ်တဲ့ အတွက် keys တွေ ပျောက်မသွားဘူး။

---

## Quick Reference

| Task | Command |
|---|---|
| Start | `sudo systemctl start aegis-forwarder` |
| Stop | `sudo systemctl stop aegis-forwarder` |
| Restart | `sudo systemctl restart aegis-forwarder` |
| Live logs | `sudo journalctl -u aegis-forwarder -f` |
| Update script | `cd /opt/aegis && git pull && sudo systemctl restart aegis-forwarder` |
| Edit config | `nano /opt/aegis/scripts/src/aegis_forwarder.local.conf` |
