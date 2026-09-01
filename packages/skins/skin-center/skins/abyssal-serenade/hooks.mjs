/**
 * abyssal-serenade skin hooks — ambient particles (x-org.linxin666.skin-center/v1alpha1).
 * Loading this module runs nothing; apply() owns every DOM write and
 * retracts it through ctx.onCleanup.
 */
export default function defineSkinHooks() {
  const LIGHT = {"color":"#9ADFEA","glow":"rgba(120,220,235,0.7)"}
  const DARK = {"color":"#BDEDF4","glow":"rgba(120,220,235,0.8)"}
  const STYLE = "bubbles"
  const COUNT = 16
  const CSS = '[data-skin-particles]{position:absolute;inset:0}[data-skin-particles] i{position:absolute;display:block;border-radius:50%;box-shadow:0 0 8px 1px var(--sk-particle-glow);opacity:0;will-change:transform,opacity;animation-iteration-count:infinite}' + "[data-skin-particles] i{animation-name:sk-rise;animation-timing-function:cubic-bezier(.3,.6,.6,1)}@keyframes sk-rise{0%{transform:translate(0,0) scale(.72);opacity:0}10%{opacity:.85}70%{opacity:.5}100%{transform:translate(var(--drift),-108vh) scale(1.04);opacity:0}}" + "@media (prefers-reduced-motion:reduce){[data-skin-particles] i{animation:none;opacity:.3}}"

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
