# FINMENTOR Brand Assets

Source
- `FINMENTOR-master-reference.png` — original project reference recovered from the user's Library.
- The four web assets below are derived from that master without redrawing the logo geometry.

Assets
- `finmentor-wordmark-on-dark.png`
  - Original silver `fin` + original gold `mentor`
  - Transparent background
  - Use on navy / dark photographic surfaces

- `finmentor-wordmark-on-light.png`
  - Same exact wordmark geometry
  - `fin` recolored to FINMENTOR navy for contrast
  - `mentor` keeps the original gold treatment
  - Transparent background
  - Use on ivory / white / light surfaces

- `finmentor-lockup-on-dark.png`
  - Emblem + wordmark + tagline
  - Original silver / gold treatment
  - Transparent background
  - Intended for intro, footer, dark brand moments

- `finmentor-lockup-on-light.png`
  - Same geometry
  - Silver/white portions recolored to FINMENTOR navy
  - Gold portions preserved
  - Transparent background
  - Intended only where the full lockup is needed on light surfaces

Implementation rules
1. Never recreate `finmentor` with HTML text or a substitute font.
2. Preserve intrinsic aspect ratio.
3. Use `width:auto; height:auto;`.
4. Do not apply CSS filters, blur, text-shadow, glow, or transform scaling.
5. For the website header, prefer the WORDMARK assets, not the full lockup.
6. Use `on-dark` over dark hero/footer/intro backgrounds.
7. Use `on-light` over ivory/white headers and reading pages.
8. Keep this source/reference file under version control so future work never needs to guess the mark again.

Recommended rendered wordmark height
- Desktop header: approximately 27–30 CSS px
- Mobile header: approximately 29–32 CSS px

The source wordmark crop is 915×185 px, giving ample pixel density for the intended header size.
