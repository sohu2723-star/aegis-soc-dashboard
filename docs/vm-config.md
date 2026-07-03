# VM Configuration Guide

## pfSense (linux2024)

pfSense ကို boot ပြီးရင် console မှာ interface assign လုပ်ပါ—

```
WAN  → vtnet0 (eth0)   IP: 10.10.0.2/30     GW: 10.10.0.1
LAN1 → vtnet1 (eth1)   IP: 10.10.10.1/24    (DMZ)
LAN2 → vtnet2 (eth2)   IP: 10.10.20.1/24    (Internal)
LAN3 → vtnet3 (eth3)   IP: 10.10.30.1/24    (MGMT/AEGIS)
```

WebGUI: `https://10.10.0.2` (R2 မှ) သို့မဟုတ် console မှ configure

### Firewall Rules (pfSense)
- DMZ → Internet: Allow (HTTP/HTTPS)
- INT → Internet: Block
- Kali → DMZ: Allow (attack traffic pass)
- pfSense → AEGIS: Allow (Suricata alerts forward)

---

## Ubuntu Bank VMs — Netplan Config

### bank-web (10.10.10.10)
```yaml
# /etc/netplan/00-installer-config.yaml
network:
  ethernets:
    ens3:
      addresses: [10.10.10.10/24]
      gateway4: 10.10.10.1
      nameservers:
        addresses: [8.8.8.8]
  version: 2
```
Apply: `sudo netplan apply`

### bank-mail (10.10.10.20)
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.10.10.20/24]
      gateway4: 10.10.10.1
      nameservers:
        addresses: [8.8.8.8]
  version: 2
```

### teller-pc (10.10.20.10)
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.10.20.10/24]
      gateway4: 10.10.20.1
      nameservers:
        addresses: [8.8.8.8]
  version: 2
```

### customer-db (10.10.20.20)
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.10.20.20/24]
      gateway4: 10.10.20.1
      nameservers:
        addresses: [8.8.8.8]
  version: 2
```

### aegis-forwarder (10.10.30.10)
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.10.30.10/24]
      gateway4: 10.10.30.1
      nameservers:
        addresses: [8.8.8.8]
  version: 2
```

---

## Services to Install on Each VM

### bank-web
```bash
sudo apt update
sudo apt install apache2 php libapache2-mod-php -y
# Bank web app deploy ပါမည်
```

### bank-mail
```bash
sudo apt install postfix dovecot-core -y
```

### customer-db
```bash
sudo apt install mysql-server -y
```

### teller-pc
```bash
# Internal teller application
sudo apt install apache2 -y
```

### aegis-forwarder
```bash
sudo apt install python3 python3-pip -y
pip3 install requests
# aegis_forwarder.py deploy ပါမည်
```
