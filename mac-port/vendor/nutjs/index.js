const libnut = require('./libnut-core')

const Key = {
  LeftShift: 'shift',
  RightShift: 'shift',
  LeftControl: 'control',
  RightControl: 'control',
  LeftAlt: 'alt',
  RightAlt: 'alt',
  LeftCmd: 'command',
  RightCmd: 'command',
  LeftSuper: 'command', // logical mapping for Nut.js compatibility
  RightSuper: 'command',
  Menu: 'menu',
  F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
  F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
  Space: 'space',
  Enter: 'enter',
  Return: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Escape: 'escape',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
  A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f', G: 'g', H: 'h', I: 'i',
  J: 'j', K: 'k', L: 'l', M: 'm', N: 'n', O: 'o', P: 'p', Q: 'q', R: 'r',
  S: 's', T: 't', U: 'u', V: 'v', W: 'w', X: 'x', Y: 'y', Z: 'z',
  Num0: '0', Num1: '1', Num2: '2', Num3: '3', Num4: '4',
  Num5: '5', Num6: '6', Num7: '7', Num8: '8', Num9: '9'
}
if (process.platform === 'darwin') {
  Key.LeftCmd = 'command'
  Key.LeftSuper = 'command'
} else {
  Key.LeftCmd = 'control'
  Key.LeftSuper = 'command' // win key
}

function normalizeModifier(mod) {
  const m = String(mod).toLowerCase()
  if (m === 'command' || m === 'cmd') return 'command'
  if (m === 'option') return 'alt'
  if (m === 'control' || m === 'ctrl') return 'control'
  if (m === 'shift') return 'shift'
  if (m === 'meta') return 'command'
  return m
}

const keyboard = {
  config: { autoDelayMs: 10 },
  _mods: new Set(),
  async type(input) {
    if (typeof input === 'string') {
      await libnut.typeString(String(input))
    } else {
      const key = String(input).toLowerCase()
      const mods = Array.from(this._mods)
      if (mods.length > 0) {
        await libnut.keyTap(key, mods)
      } else {
        await libnut.keyTap(key)
      }
    }
  },
  async pressKey(key) {
    const k = String(key).toLowerCase()
    const mod = normalizeModifier(k)
    if (['command', 'control', 'shift', 'alt'].includes(mod)) {
      this._mods.add(mod)
      return
    }
    await libnut.keyToggle(k, 'down')
  },
  async releaseKey(key) {
    const k = String(key).toLowerCase()
    const mod = normalizeModifier(k)
    if (['command', 'control', 'shift', 'alt'].includes(mod)) {
      this._mods.delete(mod)
      return
    }
    await libnut.keyToggle(k, 'up')
  }
}

const mouse = {
  async moveRelative(dx, dy) {
    const pos = libnut.getMousePos()
    const x = Math.max(0, Math.round((pos && pos.x) ? pos.x + dx : dx))
    const y = Math.max(0, Math.round((pos && pos.y) ? pos.y + dy : dy))
    await libnut.moveMouse(x, y)
  },
  async click(button = 'left') {
    let btn = String(button)
    if (button === 0) btn = 'left'
    if (button === 1) btn = 'right'
    if (button === 2) btn = 'middle'
    await libnut.mouseClick(btn)
  },
  async scroll(dx, dy) {
    await libnut.scrollMouse(Math.round(dx || 0), Math.round(dy || 0))
  },
  async scrollUp(amount) { await this.scroll(0, amount) },
  async scrollDown(amount) { await this.scroll(0, -amount) }, // robotjs scroll usually: up is positive, down is negative? or vice versa. verified: generic scroll(x,y)
  async scrollLeft(amount) { await this.scroll(-amount, 0) },
  async scrollRight(amount) { await this.scroll(amount, 0) },
  async doubleClick(button = 'left') {
    let btn = String(button)
    if (button === 0) btn = 'left'
    if (button === 1) btn = 'right'
    if (button === 2) btn = 'middle'
    await libnut.mouseClick(btn, true)
  },
  async pressButton(button = 'left') {
    await libnut.mouseToggle('down', String(button))
  },
  async releaseButton(button = 'left') {
    await libnut.mouseToggle('up', String(button))
  },
  async move(x, y) {
    await libnut.moveMouse(Math.round(Number(x) || 0), Math.round(Number(y) || 0))
  },
  async drag(fromX, fromY, toX, toY) {
    if (typeof fromX === 'number' && typeof fromY === 'number') {
      await libnut.moveMouse(Math.round(fromX), Math.round(fromY))
    }
    await libnut.dragMouse(Math.round(Number(toX) || 0), Math.round(Number(toY) || 0))
  },
  async toggle(button = 'left', state = 'down') {
    await libnut.mouseToggle(String(button), String(state))
  },
  position() {
    return libnut.getMousePos()
  }
}

const screen = {
  async highlightActiveWindow(ms = 600) {
    try {
      const w = libnut.getActiveWindow()
      const rect = libnut.getWindowRect(w)
      if (rect && typeof rect.x === 'number') {
        await libnut.highlight(rect.x, rect.y, rect.width, rect.height, Math.max(100, ms))
      }
    } catch { }
  },
  getActiveWindowInfo() {
    try {
      const w = libnut.getActiveWindow()
      const title = libnut.getWindowTitle(w)
      const rect = libnut.getWindowRect(w)
      return { title, rect }
    } catch (e) {
      return { error: e && e.message }
    }
  },
  getScreenSize() {
    try { return libnut.getScreenSize() } catch (e) { return { error: e && e.message } }
  },
  highlight(x, y, width, height, duration = 600, opacity = 0.4) {
    try { return libnut.screen.highlight(x, y, width, height, duration, opacity) } catch { }
  },
  async colorAt(point) {
    try {
      const x = (point && typeof point.x === 'number') ? point.x : 0
      const y = (point && typeof point.y === 'number') ? point.y : 0
      const color = libnut.getPixelColor(x, y) // Returns hex string or structure usually
      // libnut/robotjs usually returns hex string "FFFFFF"
      if (typeof color === 'string') {
        const r = parseInt(color.substring(0, 2), 16)
        const g = parseInt(color.substring(2, 4), 16)
        const b = parseInt(color.substring(4, 6), 16)
        return { R: r, G: g, B: b, A: 255 }
      }
      return color
    } catch (e) {
      console.error('colorAt failed', e)
      return { R: 0, G: 0, B: 0 }
    }
  },
  pixel(x, y) {
    try {
      const color = libnut.getPixelColor(x, y)
      if (typeof color === 'string') {
        const r = parseInt(color.substring(0, 2), 16)
        const g = parseInt(color.substring(2, 4), 16)
        const b = parseInt(color.substring(4, 6), 16)
        return { R: r, G: g, B: b, A: 255 }
      }
      return color
    } catch (e) {
      console.error('pixel failed', e)
      return { R: 0, G: 0, B: 0 }
    }
  }
}

// Expose capture functions if available in libnut-core
try {
  if (libnut && libnut.screen && typeof libnut.screen.capture === 'function') {
    screen.capture = function (x, y, width, height) {
      const b = libnut.screen.capture(x, y, width, height)
      // Normalize return to have .data and .toRGB for downstream consumers
      return {
        width: b && b.width,
        height: b && b.height,
        data: b && (b.image || b.data),
        toRGB: () => (b && (b.image || b.data))
      }
    }
    screen.grab = function () {
      const b = libnut.screen.capture()
      return {
        width: b && b.width,
        height: b && b.height,
        data: b && (b.image || b.data),
        toRGB: () => (b && (b.image || b.data))
      }
    }
    screen.grabRegion = function (rect) {
      const r = rect || {}
      const b = libnut.screen.capture(Number(r.left) || 0, Number(r.top) || 0, Number(r.width) || 0, Number(r.height) || 0)
      return {
        width: b && b.width,
        height: b && b.height,
        data: b && (b.image || b.data),
        toRGB: () => (b && (b.image || b.data))
      }
    }
  }
} catch { }

const windows = {
  getWindows() { try { return libnut.getWindows() } catch (e) { return { error: e && e.message } } },
  getActiveWindow() { try { return libnut.getActiveWindow() } catch (e) { return { error: e && e.message } } },
  getWindowRect(w) { try { return libnut.getWindowRect(w) } catch (e) { return { error: e && e.message } } },
  getWindowTitle(w) { try { return libnut.getWindowTitle(w) } catch (e) { return { error: e && e.message } } },
  focusWindow(w) { try { return libnut.focusWindow(w) } catch { } },
  resizeWindow(w, width, height) { try { return libnut.resizeWindow(w, Math.round(Number(width) || 0), Math.round(Number(height) || 0)) } catch { } }
}

keyboard.tap = async function (key, modifiers) {
  const k = String(key).toLowerCase()
  const mods = Array.isArray(modifiers) ? modifiers.map(normalizeModifier) : []
  if (mods.length > 0) { await libnut.keyTap(k, mods) } else { await libnut.keyTap(k) }
}

keyboard.toggle = async function (key, state) {
  await libnut.keyToggle(String(key).toLowerCase(), String(state || 'down'))
}

module.exports = {
  keyboard,
  Key,
  mouse,
  screen,
  windows,
  // Top-level aliases to match standard nut.js imports
  getWindows: windows.getWindows,
  getActiveWindow: windows.getActiveWindow,
  useJurekMouse: () => { }, // Stub
  formatResource: () => { }, // Stub
  Button: { LEFT: 0, RIGHT: 1, MIDDLE: 2 } // Add Button enum
}
