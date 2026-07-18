---
name: VM script update method
description: How to update aegis_forwarder.py on the Ubuntu VM — git pull doesn't work there.
---

# VM Script Update Method

**Rule:** Ubuntu VM (`/opt/aegis/scripts/src/`) မှာ `git pull` အလုပ်မလုပ်ဘူး။ Script update လုပ်ဖို့ `wget` နဲ့ GitHub raw URL ကနေ တိုက်ရိုက် download ရမယ်။

**Why:** VM မှာ git repo clone မထားဘူး၊ script ကို manually ထည့်ထားတာ။

**How to apply:**
```bash
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
```

`aegis_forwarder.local.conf` ကိုတော့ မထိနဲ့ — gitignored, machine-specific config ဆိုတော့ overwrite မဖြစ်ရဘူး။
