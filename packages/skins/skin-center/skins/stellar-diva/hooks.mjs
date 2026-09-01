/**
 * stellar-diva skin hooks — ambient particles (x-org.linxin666.skin-center/v1alpha1).
 * Loading this module runs nothing; apply() owns every DOM write and
 * retracts it through ctx.onCleanup.
 */
export default function defineSkinHooks() {
  const LIGHT = {"color":"#8FB7FF","glow":"rgba(143,183,255,0.85)"}
  const DARK = {"color":"#AFCDFB","glow":"rgba(143,183,255,0.8)"}
  const STYLE = "stars"
  const COUNT = 18
  const CSS = '[data-skin-particles]{position:absolute;inset:0}[data-skin-particles] i{position:absolute;display:block;border-radius:50%;box-shadow:0 0 8px 1px var(--sk-particle-glow);opacity:0;will-change:transform,opacity;animation-iteration-count:infinite}' + "[data-skin-particles] i{animation-name:sk-float;animation-timing-function:ease-in-out}@keyframes sk-float{0%,100%{transform:translate(0,0) scale(.9);opacity:.1}25%{opacity:.9}50%{transform:translate(var(--drift),-3.2vh) scale(1.05);opacity:.35}75%{opacity:.85}}" + "@media (prefers-reduced-motion:reduce){[data-skin-particles] i{animation:none;opacity:.3}}"

  function build() {
    const style = document.createElement('style')
    style.setAttribute('data-skin-hooks-style', '')
    style.textContent = CSS
    document.head.append(style)
    const wrap = document.createElement('div')
    wrap.setAttribute('data-skin-particles', '')
    wrap.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < COUNT; i++) {
      const dot = document.createElement('i')
      const size = STYLE === 'bubbles' ? 3 + Math.random() * 9 : 1.5 + Math.random() * 3.2
      dot.style.top = STYLE === 'bubbles' ? 'auto' : (Math.random() * 88).toFixed(2) + '%'
      dot.style.bottom = STYLE === 'bubbles' ? '-6vh' : 'auto'
      dot.style.left = (Math.random() * 100).toFixed(2) + '%'
      dot.style.width = size.toFixed(1) + 'px'
      dot.style.height = size.toFixed(1) + 'px'
      dot.style.animationDelay = (-Math.random() * 22).toFixed(2) + 's'
      dot.style.animationDuration = (STYLE === 'bubbles' ? 9 + Math.random() * 10 : 5 + Math.random() * 9).toFixed(2) + 's'
      dot.style.setProperty('--drift', ((Math.random() * 2 - 1) * 7).toFixed(2) + 'vw')
      wrap.appendChild(dot)
    }
    return { style, wrap }
  }

  return {
    apply(ctx) {
      const { style, wrap } = build()
      const paint = () => {
        const c = ctx.theme.get() === 'dark' ? DARK : LIGHT
        wrap.style.setProperty('--sk-particle', c.color)
        wrap.style.setProperty('--sk-particle-glow', c.glow)
      }
      wrap.style.setProperty('--sk-particle', LIGHT.color)
      wrap.style.setProperty('--sk-particle-glow', LIGHT.glow)
      ctx.layers.ambient.appendChild(wrap)
      const unsubscribe = ctx.theme.subscribe(() => paint())
      ctx.onCleanup(() => { unsubscribe(); wrap.remove(); style.remove() })
    },
  }
}
