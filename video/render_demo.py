"""Renders the docsXAi animated demo video (1280x720, 30 fps) straight into ffmpeg."""
import math
import subprocess
import sys

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 30
OUT = sys.argv[1] if len(sys.argv) > 1 else "docsxai-demo.mp4"
PREVIEW = sys.argv[2:]  # optional: times in seconds to save as PNG stills instead of a video

# Palette (matches the title cards)
BG = (15, 34, 56)
PANEL = (23, 49, 80)
DEEP = (11, 22, 38)
PAPER = (242, 245, 249)
DIM = (159, 176, 198)
LINE = (52, 72, 102)
AMBER = (245, 176, 46)
AMBER_SOFT = (255, 225, 166)
TG = (43, 143, 214)
TG_SOFT = (191, 230, 250)
BOTB = (29, 51, 80)
GREEN = (61, 196, 128)
CLAUDE_BG = (38, 38, 36)
CLAUDE_PANEL = (48, 48, 46)
CLAUDE_TEXT = (236, 234, 228)
CLAUDE_DIM = (160, 158, 150)

FONTS = "C:/Windows/Fonts/"
_cache = {}


def font(kind, size):
    key = (kind, size)
    if key not in _cache:
        path = {"bold": "segoeuib.ttf", "reg": "segoeui.ttf", "mono": "consola.ttf", "monob": "consolab.ttf"}[kind]
        _cache[key] = ImageFont.truetype(FONTS + path, size)
    return _cache[key]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def prog(t, start, dur):
    return ease((t - start) / dur)


def mix(c1, c2, a):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * a) for i in range(3))


def wrap(text, f, maxw):
    lines, cur = [], ""
    for word in text.split(" "):
        test = (cur + " " + word).strip()
        if f.getlength(test) <= maxw:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


class Frame:
    def __init__(self):
        self.img = Image.new("RGBA", (W, H), BG + (255,))
        self.d = ImageDraw.Draw(self.img)
        for x in range(0, W, 52):
            self.d.line([(x, 0), (x, H)], fill=(25, 46, 70, 255))
        for y in range(0, H, 52):
            self.d.line([(0, y), (W, y)], fill=(25, 46, 70, 255))

    def layer(self, alpha, draw_fn):
        """Draw with draw_fn(ImageDraw) at the given opacity."""
        if alpha <= 0.003:
            return
        if alpha >= 0.997:
            draw_fn(self.d)
            return
        lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw_fn(ImageDraw.Draw(lay))
        a = lay.getchannel("A").point(lambda v: int(v * alpha))
        lay.putalpha(a)
        self.img.alpha_composite(lay)


# ---------- shared pieces ----------

def chrome(fr, t, step=None, total=7):
    def brand(d):
        d.ellipse([60, 38, 74, 52], fill=AMBER)
        d.text((84, 45), "docsXAi", font=font("mono", 20), fill=DIM, anchor="lm")
    fr.layer(1, brand)
    if step:
        def bar(d):
            x0, w, gap = 60, (1160 - (total - 1) * 8) / total, 8
            for k in range(total):
                x = x0 + k * (w + gap)
                d.rounded_rectangle([x, 604, x + w, 609], radius=3, fill=AMBER if k < step else (40, 62, 92))
        fr.layer(1, bar)


def caption(fr, t, en, bm, start=0.3):
    a = prog(t, start, 0.5)

    def draw(d):
        d.rounded_rectangle([60, 626, 1220, 700], radius=12, fill=DEEP)
        d.text((640, 650), en, font=font("bold", 24), fill=PAPER, anchor="mm")
        d.text((640, 681), bm, font=font("reg", 19), fill=DIM, anchor="mm")
    fr.layer(a, draw)


def left_text(fr, t, step, title, sub, total=7):
    if step:
        a = prog(t, 0.1, 0.4)
        fr.layer(a, lambda d: d.text((90, 150), f"STEP {step} OF {total}", font=font("monob", 20), fill=AMBER, anchor="lm"))
    tf = font("bold", 52)
    lines = wrap(title, tf, 600)
    for li, line in enumerate(lines):
        a = prog(t, 0.2 + li * 0.12, 0.5)
        dy = int((1 - a) * 24)
        fr.layer(a, lambda d, line=line, li=li, dy=dy: d.text((88, 200 + li * 60 + dy), line, font=tf, fill=PAPER, anchor="lm"))
    sf = font("reg", 24)
    y0 = 200 + len(lines) * 60 + 20
    for si, line in enumerate(wrap(sub, sf, 560)):
        a = prog(t, 0.55, 0.5)
        fr.layer(a, lambda d, line=line, si=si: d.text((90, y0 + si * 34), line, font=sf, fill=DIM, anchor="lm"))


def typed(text, t, start, cps=22):
    n = int(clamp((t - start) * cps, 0, len(text)))
    return text[:n]


def check(d, x, y, s, color):
    d.line([(x, y + s * 0.5), (x + s * 0.38, y + s * 0.85), (x + s, y + s * 0.1)], fill=color, width=max(3, int(s / 6)))


# ---------- phone (Telegram) ----------

def phone(fr, t, title, bubbles, x=780, y=110, w=400, h=480):
    def body(d):
        d.rounded_rectangle([x, y, x + w, y + h], radius=34, fill=DEEP, outline=LINE, width=2)
        d.rounded_rectangle([x + 2, y + 2, x + w - 2, y + 70], radius=32, fill=(19, 38, 62))
        d.rectangle([x + 2, y + 40, x + w - 2, y + 70], fill=(19, 38, 62))
        d.ellipse([x + 22, y + 18, x + 58, y + 54], fill=TG)
        d.text((x + 40, y + 36), "A", font=font("bold", 20), fill=PAPER, anchor="mm")
        d.text((x + 72, y + 26), "AdminAi", font=font("bold", 19), fill=PAPER, anchor="lm")
        d.text((x + 72, y + 48), title, font=font("reg", 15), fill=DIM, anchor="lm")
    fr.layer(1, body)
    by = y + h - 24
    shown = [b for b in bubbles if t >= b[2]]
    bf = font("reg", 17)
    mf = font("mono", 17)
    items = []
    for side, text, start in shown:
        f = mf if text.startswith("/") else bf
        lines = []
        for para in text.split("\n"):
            lines += wrap(para, f, w - 120) or [""]
        items.append((side, lines, start, f))
    heights = [len(lines) * 24 + 22 for _, lines, _, _ in items]
    total = sum(heights) + 12 * max(0, len(items) - 1)
    cy = by - total
    for (side, lines, start, f), bh in zip(items, heights):
        a = prog(t, start, 0.35)
        dy = int((1 - a) * 18)
        bw = max(f.getlength(l) for l in lines) + 32
        bx = x + w - 24 - bw if side == "me" else x + 24
        col = TG if side == "me" else BOTB

        def draw(d, lines=lines, bx=bx, bw=bw, cy=cy, bh=bh, col=col, dy=dy, f=f):
            d.rounded_rectangle([bx, cy + dy, bx + bw, cy + bh + dy], radius=16, fill=col)
            for li, line in enumerate(lines):
                fill = AMBER_SOFT if "•" in line else PAPER
                d.text((bx + 16, cy + dy + 11 + li * 24), line, font=f, fill=fill)
        if cy > y + 74:
            fr.layer(a, draw)
        cy += bh + 12


# ---------- claude.ai mocks ----------

def window(d, x, y, w, h, title):
    d.rounded_rectangle([x, y, x + w, y + h], radius=16, fill=CLAUDE_BG, outline=(70, 70, 66), width=2)
    for k, c in enumerate([(237, 106, 94), (245, 191, 79), (98, 197, 84)]):
        d.ellipse([x + 18 + k * 20, y + 16, x + 30 + k * 20, y + 28], fill=c)
    d.text((x + w / 2, y + 22), title, font=font("reg", 15), fill=CLAUDE_DIM, anchor="mm")
    d.line([(x, y + 44), (x + w, y + 44)], fill=(62, 62, 58), width=1)


def chat(fr, t, prompt, prompt_start, tool, tool_t, reply_lines, reply_t, x=720, y=110, w=480, h=480):
    def base(d):
        window(d, x, y, w, h, "claude.ai")
    fr.layer(1, base)
    pf = font("reg", 18)
    shown = typed(prompt, t, prompt_start, 30)
    if shown:
        lines = wrap(shown, pf, w - 140)
        bw = max(pf.getlength(l) for l in wrap(prompt, pf, w - 140)) + 36
        bh = len(wrap(prompt, pf, w - 140)) * 26 + 20

        def bubble(d):
            bx = x + w - 24 - bw
            d.rounded_rectangle([bx, y + 66, x + w - 24, y + 66 + bh], radius=14, fill=CLAUDE_PANEL)
            for li, line in enumerate(lines):
                d.text((bx + 18, y + 76 + li * 26), line, font=pf, fill=CLAUDE_TEXT)
        fr.layer(1, bubble)
        ty = y + 66 + bh + 24
    else:
        ty = y + 120
    if t >= tool_t:
        a = prog(t, tool_t, 0.3)
        done = t >= tool_t + 1.0

        def toolchip(d):
            d.rounded_rectangle([x + 24, ty, x + 24 + 330, ty + 34], radius=17, outline=(80, 80, 76), width=1)
            if done:
                check(d, x + 38, ty + 10, 14, GREEN)
            else:
                ang = (t * 360) % 360
                d.arc([x + 36, ty + 9, x + 52, ty + 25], ang, ang + 270, fill=AMBER, width=3)
            d.text((x + 62, ty + 17), tool, font=font("reg", 15), fill=CLAUDE_DIM, anchor="lm")
        fr.layer(a, toolchip)
    ry = ty + 52
    rf = font("reg", 18)
    mf = font("mono", 16)
    for k, line in enumerate(reply_lines):
        st = reply_t + k * 0.28
        if t < st:
            break
        a = prog(t, st, 0.3)
        is_code = line.startswith("  ")
        f = mf if is_code else rf
        wrapped = wrap(line.strip(), f, w - 70)

        def draw(d, wrapped=wrapped, ry=ry, is_code=is_code, f=f):
            for li, l in enumerate(wrapped):
                if is_code:
                    tw = f.getlength(l)
                    d.rounded_rectangle([x + 44, ry + li * 26 - 2, x + 56 + tw, ry + li * 26 + 22], radius=5, fill=CLAUDE_PANEL)
                    d.text((x + 50, ry + li * 26), l, font=f, fill=CLAUDE_TEXT)
                else:
                    d.text((x + 28, ry + li * 26), l, font=f, fill=CLAUDE_TEXT)
        fr.layer(a, draw)
        ry += len(wrapped) * 26 + (4 if is_code else 8)


# ---------- scenes ----------

def s_intro(fr, t):
    tf = font("bold", 66)
    words = "Write docs by chatting with Claude".split(" ")
    lines = [" ".join(words[:3]), " ".join(words[3:])]
    k = 0
    for li, line in enumerate(lines):
        xx = 90
        for wd in line.split(" "):
            a = prog(t, 0.2 + k * 0.08, 0.5)
            dy = int((1 - a) * 30)
            fr.layer(a, lambda d, xx=xx, wd=wd, li=li, dy=dy: d.text((xx, 230 + li * 80 + dy), wd, font=tf, fill=PAPER, anchor="lm"))
            xx += tf.getlength(wd + " ")
            k += 1
    a = prog(t, 1.1, 0.6)
    fr.layer(a, lambda d: d.text((92, 410), "Request access  ·  connect  ·  publish  ·  live in about a minute", font=font("reg", 28), fill=DIM, anchor="lm"))
    a = prog(t, 1.6, 0.6)

    def chips(d):
        xx = 92
        for txt in ["Telegram bot", "claude.ai connector", "Docs site"]:
            tw = font("mono", 20).getlength(txt)
            d.rounded_rectangle([xx, 470, xx + tw + 36, 512], radius=21, outline=TG, width=2, fill=(24, 55, 86))
            d.text((xx + 18, 491), txt, font=font("mono", 20), fill=TG_SOFT, anchor="lm")
            xx += tw + 56
    fr.layer(a, chips)
    caption(fr, t, "A quick tour: from asking for access to a live page", "Lawatan ringkas: daripada minta akses hingga halaman live", 1.8)


def s_request(fr, t):
    left_text(fr, t, 1, "Request access", "Your friend opens the bot on Telegram, presses Start and sends /access.")
    phone(fr, t, "@ArifDocsAgentic_bot", [
        ("me", "/access", 1.2),
        ("bot", "Permintaan anda telah dihantar kepada pemilik. Anda akan menerima URL connector di sini selepas diluluskan.", 2.4),
    ])
    caption(fr, t, "Your friend sends /access to the bot", "Kawan anda hantar /access kepada bot")


def s_approve(fr, t):
    left_text(fr, t, 2, "The owner approves", "The bot hands you a ready-made command. Send it back, and that's it.")
    phone(fr, t, "Owner's chat", [
        ("bot", "Ali (@ali, chat ID 987654321) minta akses docs-publisher.\n\nUntuk lulus, hantar:\n/approve 987654321 ali", 0.8),
        ("me", "/approve 987654321 ali", 3.4),
        ("bot", "Kunci dicipta untuk ali dan URL telah dihantar kepada mereka.", 4.8),
    ])
    caption(fr, t, "You approve with one message", "Anda luluskan dengan satu mesej")


def s_url(fr, t):
    left_text(fr, t, 3, "Get your personal URL", "It arrives in the same chat. Treat it like a password and delete the message after use.")
    phone(fr, t, "@ArifDocsAgentic_bot", [
        ("me", "/access", -9),
        ("bot", "Hai ali! Permintaan anda diluluskan. Ini URL connector docs-publisher peribadi anda:\n\nhttps://docs-publisher…/mcp/••••••••\n\nRahsiakan URL ini, ia seperti kata laluan.", 0.8),
    ])
    a = prog(t, 2.6, 0.5)

    def lock(d):
        d.rounded_rectangle([90, 470, 430, 520], radius=25, fill=(64, 47, 16), outline=AMBER, width=2)
        d.rounded_rectangle([110, 489, 132, 507], radius=3, fill=AMBER)
        d.arc([113, 477, 129, 497], 180, 360, fill=AMBER, width=3)
        d.text((146, 495), "Keep it private", font=font("bold", 21), fill=AMBER_SOFT, anchor="lm")
    fr.layer(a, lock)
    caption(fr, t, "The personal connector URL arrives in Telegram", "URL connector peribadi tiba di Telegram")


def s_connector(fr, t):
    left_text(fr, t, 4, "Add the connector", "claude.ai › Customize › Connectors › Add custom connector")
    x, y, w, h = 720, 120, 480, 390

    def dlg(d):
        window(d, x, y, w, h, "Add custom connector")
        d.text((x + 28, y + 74), "Name", font=font("bold", 16), fill=CLAUDE_TEXT)
        d.rounded_rectangle([x + 28, y + 100, x + w - 28, y + 144], radius=8, fill=CLAUDE_PANEL, outline=(80, 80, 76))
        d.text((x + 28, y + 168), "MCP server URL", font=font("bold", 16), fill=CLAUDE_TEXT)
        d.rounded_rectangle([x + 28, y + 194, x + w - 28, y + 238], radius=8, fill=CLAUDE_PANEL, outline=(80, 80, 76))
        d.text((x + 28, y + 256), "The HTTPS address where the server accepts MCP requests.", font=font("reg", 14), fill=CLAUDE_DIM)
    fr.layer(1, dlg)
    name = typed("docs-publisher", t, 1.0, 16)
    url = typed("https://docs-publisher.example.ts.net/mcp/••••••", t, 2.4, 26)
    caret_on = int(t * 2) % 2 == 0

    def fields(d):
        d.text((x + 42, y + 122), name + ("|" if 1.0 <= t < 2.3 and caret_on else ""), font=font("reg", 18), fill=CLAUDE_TEXT, anchor="lm")
        d.text((x + 42, y + 216), url + ("|" if 2.4 <= t < 4.6 and caret_on else ""), font=font("mono", 15), fill=CLAUDE_TEXT, anchor="lm")
    fr.layer(1, fields)
    press = 1.0 - 0.06 * math.sin(clamp((t - 4.9) / 0.3) * math.pi)

    def buttons(d):
        bx, by = x + w - 150, y + h - 70
        d.rounded_rectangle([bx - 110, by, bx - 14, by + 40], radius=8, outline=(90, 90, 86), fill=CLAUDE_BG)
        d.text((bx - 62, by + 20), "Cancel", font=font("reg", 16), fill=CLAUDE_TEXT, anchor="mm")
        cw, ch = 122 * press, 40 * press
        hot = t >= 4.7
        d.rounded_rectangle([bx + 61 - cw / 2, by + 20 - ch / 2, bx + 61 + cw / 2, by + 20 + ch / 2], radius=8, fill=PAPER if hot else (120, 120, 116))
        d.text((bx + 61, by + 20), "Continue", font=font("bold", 16), fill=(30, 30, 28), anchor="mm")
    fr.layer(1, buttons)
    a = prog(t, 5.6, 0.4)

    def toast(d):
        d.rounded_rectangle([x + 70, y + h + 18, x + w - 70, y + h + 62], radius=12, fill=CLAUDE_PANEL, outline=GREEN, width=2)
        check(d, x + 92, y + h + 30, 18, GREEN)
        d.text((x + 122, y + h + 40), "Connected to docs-publisher", font=font("bold", 17), fill=CLAUDE_TEXT, anchor="lm")
    fr.layer(a, toast)
    caption(fr, t, "Add it once in claude.ai: name, URL, Continue", "Tambah sekali dalam claude.ai: nama, URL, Continue")


def s_test(fr, t):
    left_text(fr, t, 5, "Test it", "Start a new chat and ask Claude to list the tutorials.")
    chat(fr, t, "List the tutorials in my docs.", 0.9, "Used docs-publisher: List tutorials", 2.2,
         ["Your docs have 4 tutorials:", "  docs/how-to-make-nasi-lemak.md", "  docs/how-to-make-paperplane.md", "  docs/scp-001.md", "  docs/set-up-in-claude.md"], 3.4)
    caption(fr, t, "If you see the list, you're connected", "Jika senarai muncul, anda sudah bersambung")


def s_publish(fr, t):
    left_text(fr, t, 6, "Ask Claude to publish", "Plain words are enough. Claude writes the tutorial and publishes it through the connector.")
    chat(fr, t, "Write a tutorial on making teh tarik and publish it.", 0.9, "docs-publisher: Publish tutorial", 3.0,
         ["Created docs/how-to-make-teh-tarik.md on branch main.", "The site is being deployed and will be live in a minute or two."], 4.3)
    p = clamp((t - 5.2) / 2.2)
    live = p >= 1

    def bar(d):
        x, y, w = 90, 470, 420
        d.rounded_rectangle([x, y, x + w, y + 14], radius=7, fill=DEEP)
        if p > 0:
            d.rounded_rectangle([x, y, x + w * p, y + 14], radius=7, fill=GREEN if live else AMBER)
        label = "Live on the site" if live else f"Deploying by itself…  {int(p * 60)}s"
        d.text((x, y + 42), label, font=font("bold" if live else "reg", 20), fill=GREEN if live else DIM, anchor="lm")
        if live:
            check(d, x + w - 26, y + 30, 24, GREEN)
    fr.layer(prog(t, 5.0, 0.3), bar)
    caption(fr, t, "Ask in plain words: it goes live by itself, no review step", "Minta dalam bahasa biasa: ia live sendiri, tanpa semakan")


def s_image(fr, t):
    left_text(fr, t, 7, "Add pictures", "Give Claude a link to a photo you may reuse. It saves a copy on the site and credits the author.")
    chat(fr, t, "Add this photo to the teh tarik tutorial and credit the author: https://upload.wikimedia.org/…/Teh_tarik.jpg",
         0.9, "docs-publisher: Upload image", 3.6,
         ["Added static/img/teh-tarik/pouring.jpg (212 KB) on branch main.",
          "Edited docs/how-to-make-teh-tarik.md: the photo is under the intro, with a credit at the end.",
          "The site is being deployed and will be live in a minute or two."], 4.9)
    caption(fr, t, "Photos are stored in your repo, so they never break", "Gambar disimpan dalam repo anda, jadi ia tidak rosak")


def s_site(fr, t):
    x, y, w, h = 120, 90, 1040, 500

    def browser(d):
        d.rounded_rectangle([x, y, x + w, y + h], radius=16, fill=(27, 27, 29), outline=(70, 70, 76), width=2)
        for k, c in enumerate([(237, 106, 94), (245, 191, 79), (98, 197, 84)]):
            d.ellipse([x + 18 + k * 20, y + 16, x + 30 + k * 20, y + 28], fill=c)
        d.rounded_rectangle([x + 100, y + 10, x + w - 40, y + 34], radius=12, fill=(44, 44, 48))
        d.text((x + 118, y + 22), "arfzkwn-coder.github.io/docsXAi/docs/how-to-make-teh-tarik", font=font("mono", 15), fill=(190, 190, 196), anchor="lm")
        d.rectangle([x + 2, y + 46, x + w - 2, y + 92], fill=(36, 37, 42))
        d.text((x + 28, y + 69), "docsXAi", font=font("bold", 19), fill=PAPER, anchor="lm")
        d.text((x + 130, y + 69), "Tutorials", font=font("reg", 17), fill=(160, 150, 240), anchor="lm")
        d.line([(x + 270, y + 92), (x + 270, y + h - 2)], fill=(52, 52, 58))
    fr.layer(1, browser)
    items = ["Set Up the Connector in Claude", "SCP-001", "How to Make Nasi Lemak", "How to Make a Paper Plane"]

    def side(d):
        for k, it in enumerate(items):
            d.text((x + 26, y + 124 + k * 40), it if len(it) < 24 else it[:22] + "…", font=font("reg", 17), fill=(205, 205, 210), anchor="lm")
    fr.layer(1, side)
    a = prog(t, 1.0, 0.6)

    def new_item(d):
        yy = y + 124 + 4 * 40
        d.rounded_rectangle([x + 14, yy - 17, x + 258, yy + 17], radius=6, fill=(56, 50, 100))
        d.text((x + 26 - int((1 - a) * 30), yy), "How to Make Teh Tarik", font=font("bold", 17), fill=(196, 188, 255), anchor="lm")
    fr.layer(a, new_item)
    a2 = prog(t, 1.6, 0.6)

    def page(d):
        d.text((x + 320, y + 150), "How to Make Teh Tarik", font=font("bold", 46), fill=PAPER, anchor="lm")
        d.text((x + 322, y + 206), "Malaysia's pulled milk tea, step by step.", font=font("reg", 21), fill=(190, 190, 196), anchor="lm")
        # The uploaded photo: a glass of teh tarik with its frothy top.
        px, py, pw, ph = x + 322, y + 240, 330, 200
        d.rounded_rectangle([px, py, px + pw, py + ph], radius=10, fill=(92, 62, 40))
        d.rounded_rectangle([px + 125, py + 40, px + 205, py + 180], radius=8, fill=(196, 140, 92))
        d.rounded_rectangle([px + 125, py + 40, px + 205, py + 70], radius=8, fill=(240, 222, 196))
        d.text((px, py + ph + 18), "Photo: credited author, CC BY-SA", font=font("reg", 15), fill=(150, 150, 158), anchor="lm")
        for k, ww in enumerate([300, 260, 280, 220, 300, 180]):
            d.rounded_rectangle([px + pw + 30, py + 6 + k * 30, px + pw + 30 + ww, py + 18 + k * 30], radius=6, fill=(48, 48, 54))
    fr.layer(a2, page)
    a3 = prog(t, 2.6, 0.4)

    def badge(d):
        d.rounded_rectangle([x + w - 250, y + h - 66, x + w - 30, y + h - 22], radius=22, fill=(20, 60, 40), outline=GREEN, width=2)
        check(d, x + w - 232, y + h - 54, 20, GREEN)
        d.text((x + w - 200, y + h - 44), "Live on the site", font=font("bold", 18), fill=(170, 240, 200), anchor="lm")
    fr.layer(a3, badge)
    caption(fr, t, "Refresh the docs site, and the new page is there", "Muat semula laman docs, dan halaman baharu sudah ada")


def s_control(fr, t):
    left_text(fr, t, None, "The owner stays in control", "Anyone with a URL publishes straight to the site, so approve only people you trust. Manage them all from Telegram.")
    rows = [("/approve 987654321 ali", "Give someone their URL"), ("/list", "See who has access"),
            ("/revoke ali", "Turn their URL off now")]
    for k, (cmd, desc) in enumerate(rows):
        a = prog(t, 0.9 + k * 0.4, 0.4)
        yy = 170 + k * 110

        def row(d, cmd=cmd, desc=desc, yy=yy, a=a):
            dx = int((1 - a) * 30)
            d.rounded_rectangle([740 + dx, yy, 1200 + dx, yy + 76], radius=14, fill=PANEL, outline=LINE, width=2)
            d.text((766 + dx, yy + 26), cmd, font=font("monob", 22), fill=AMBER if cmd != "/revoke ali" else (255, 140, 120), anchor="lm")
            d.text((766 + dx, yy + 54), desc, font=font("reg", 18), fill=DIM, anchor="lm")
        fr.layer(a, row)
    caption(fr, t, "Approve, list or revoke from your phone", "Lulus, senarai atau tarik balik dari telefon anda")


def s_outro(fr, t):
    a = prog(t, 0.2, 0.5)
    fr.layer(a, lambda d: d.text((640, 230), "Get started", font=font("bold", 76), fill=PAPER, anchor="mm"))
    a = prog(t, 0.8, 0.5)

    def links(d):
        for k, (txt, col) in enumerate([("arfzkwn-coder.github.io/docsXAi", AMBER_SOFT), ("@ArifDocsAgentic_bot", TG_SOFT)]):
            f = font("mono", 30)
            tw = f.getlength(txt)
            yy = 330 + k * 84
            d.rounded_rectangle([640 - tw / 2 - 30, yy - 30, 640 + tw / 2 + 30, yy + 30], radius=30, fill=PANEL, outline=AMBER if k == 0 else TG, width=2)
            d.text((640, yy), txt, font=f, fill=col, anchor="mm")
    fr.layer(a, links)
    a = prog(t, 1.4, 0.5)
    fr.layer(a, lambda d: d.text((640, 520), "Read the guide, then message the bot.  ·  Baca panduan, kemudian mesej bot.", font=font("reg", 22), fill=DIM, anchor="mm"))


SCENES = [
    (s_intro, 5.0, None), (s_request, 7.0, 1), (s_approve, 8.0, 2), (s_url, 6.5, 3),
    (s_connector, 8.5, 4), (s_test, 7.0, 5), (s_publish, 9.0, 6), (s_image, 9.0, 7),
    (s_site, 6.0, None), (s_control, 6.5, None), (s_outro, 5.5, None),
]
TOTAL = sum(d for _, d, _ in SCENES)
FADE = 0.35


def render(time):
    acc = 0.0
    for fn, dur, step in SCENES:
        if time < acc + dur or fn is SCENES[-1][0]:
            lt = time - acc
            fr = Frame()
            chrome(fr, lt, step)
            fn(fr, lt)
            img = fr.img.convert("RGB")
            f = min(clamp(lt / FADE), clamp((dur - lt) / FADE)) if fn is not s_intro else clamp((dur - lt) / FADE)
            if fn is s_outro:
                f = min(clamp(lt / FADE), clamp((dur - lt) / 0.8))
            if f < 1:
                img = Image.blend(Image.new("RGB", (W, H), BG), img, f)
            return img
        acc += dur


if PREVIEW:
    for s in PREVIEW:
        render(float(s)).save(f"{OUT}-{s}.png")
    print("stills saved")
    sys.exit(0)

frames = int(TOTAL * FPS)
cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
       "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
       "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
for i in range(frames):
    proc.stdin.write(render(i / FPS).tobytes())
    if i % (FPS * 10) == 0:
        print(f"{i / FPS:.0f}s / {TOTAL:.0f}s", flush=True)
proc.stdin.close()
proc.wait()
print("done", OUT, f"{TOTAL:.1f}s", frames, "frames")
