from PIL import Image, ImageDraw, ImageFont
import os

def create_placeholder(text, filename):
    # Create a gray image
    img = Image.new('RGB', (800, 400), color=(220, 220, 220))
    d = ImageDraw.Draw(img)
    
    # Try to use a font, fallback to default
    try:
        font = ImageFont.load_default()
    except:
        font = None
    
    # Draw border
    d.rectangle([10, 10, 790, 390], outline=(100, 100, 100), width=5)
    
    # Draw text
    d.text((400, 200), text, fill=(50, 50, 50), anchor="mm")
    
    img.save(filename)

# Create generic placeholder
create_placeholder("INSERT FIGURE HERE", "placeholder.png")

# Create specific placeholders for key figures to make it VERY obvious
figures = [
    "Figure 4.2: pfSense Interface Configuration",
    "Figure 4.3.4: OpenLDAP Directory Structure",
    "Figure 4.5: Fail2ban Jail Configuration",
    "Figure 4.6: Suricata IDS EVE JSON Output",
    "Figure 4.9: AEGIS Dashboard - Main Overview",
    "Figure 4.10: AEGIS Dashboard - Live Threat Map",
    "Figure 4.11: AEGIS Dashboard - Defense Center",
    "Figure 4.12: AEGIS Dashboard - Events Page",
    "Figure 4.13: AEGIS Dashboard - Reports Page",
    "Figure 4.14: Telegram Notification Sample",
    "Figure 5.1: Hydra SSH Brute Force Attack",
    "Figure 5.2: Brute Force Detection Alert",
    "Figure 5.3: sqlmap SQL Injection Result",
    "Figure 5.4: hping3 DDoS Simulation",
    "Figure 5.5: Auto-Defense Command Queue"
]

for fig in figures:
    filename = fig.split(":")[0].replace(" ", "_").replace(".", "_").lower() + ".png"
    create_placeholder(fig, filename)
    print(f"Created {filename}")
