export function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const beeps = [0, 0.25]
    beeps.forEach(offset => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.5, ctx.currentTime + offset)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18)
      osc.start(ctx.currentTime + offset)
      osc.stop(ctx.currentTime  + offset + 0.18)
    })
  } catch {
    // AudioContext unavailable — fail silently
  }
}
