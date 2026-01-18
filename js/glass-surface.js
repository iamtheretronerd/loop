
/**
 * Glass Surface Implementation
 * Ported from src/bits/GlassSurface.jsx for Vanilla JS
 * Modified to support additional backdrop blur and avoid layout disruption
 */

export function supportsSVGFilters() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return false;
    }
    const isWebkit = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const isFirefox = /Firefox/.test(navigator.userAgent);

    if (isWebkit || isFirefox) {
        return false;
    }

    return true;
}

export function injectGlassSurfaceStyles() {
    if (document.getElementById('glass-surface-styles')) return;

    const css = `
.glass-surface {
  position: relative;
  /* overflow: hidden; */ /* Removing overflow hidden as it might clip popups */
  transition: opacity 0.26s ease-out;
}

.glass-surface__filter {
  width: 100%;
  height: 100%;
  pointer-events: none;
  position: absolute;
  inset: 0;
  opacity: 1; /* Default opacity should be 1? React code said 0? No, React code opacity prop is for the rect inside. 
                 React CSS line 16 said opacity: 0. 
                 Wait, GlassSurface.css line 16 says .glass-surface__filter{ opacity: 0 }. 
                 If it is 0, it is invisible!
                 Line 16 in React CSS: .glass-surface__filter { opacity: 0; ... }
                 Why? Maybe it fades in?
                 React component uses feImageRef etc. 
                 Actually, the filter is applied via backdrop-filter on the PARENT (.glass-surface--svg).
                 The SVG element itself (.glass-surface__filter) serves only to DEFINE the filter via <defs>.
                 It shouldn't be visible itself (it contains <defs>).
                 So opacity: 0 or display: none (but Firefox needs display block for filters to work? No, defs work hidden).
                 However, pointer-events: none and z-index: -1 is fine.
                 Let's keep opacity 0 to be safe, or just visibility hidden?
                 Actually, if opacity is 0, does the ID reference still work? Yes.
                 */
  opacity: 0;
  z-index: -1;
}

/* Removed .glass-surface__content rules to preserve original layout */

.glass-surface--svg {
  background: hsl(0 0% 100% / var(--glass-frost, 0));
  backdrop-filter: blur(var(--glass-blur, 0px)) var(--filter-id, url(#glass-filter)) saturate(var(--glass-saturation, 1));
  box-shadow:
    0 0 2px 1px rgba(0,0,0,0.1) inset,
    0 0 10px 4px rgba(0,0,0,0.05) inset,
    0px 4px 16px rgba(17, 17, 26, 0.05),
    0px 8px 24px rgba(17, 17, 26, 0.05),
    0px 16px 56px rgba(17, 17, 26, 0.05),
    0px 4px 16px rgba(17, 17, 26, 0.05) inset,
    0px 8px 24px rgba(17, 17, 26, 0.05) inset,
    0px 16px 56px rgba(17, 17, 26, 0.05) inset;
}

.glass-surface--fallback {
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(12px) saturate(1.8) brightness(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.8) brightness(1.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow:
    0 8px 32px 0 rgba(31, 38, 135, 0.2),
    0 2px 16px 0 rgba(31, 38, 135, 0.1),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.4),
    inset 0 -1px 0 0 rgba(255, 255, 255, 0.2);
}

@media (prefers-color-scheme: dark) {
  .glass-surface--fallback {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(12px) saturate(1.8) brightness(1.2);
    -webkit-backdrop-filter: blur(12px) saturate(1.8) brightness(1.2);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow:
      inset 0 1px 0 0 rgba(255, 255, 255, 0.2),
      inset 0 -1px 0 0 rgba(255, 255, 255, 0.1);
  }
}

.glass-surface:focus-visible {
  outline: 2px solid #007aff;
  outline-offset: 2px;
}
    `;

    const style = document.createElement('style');
    style.id = 'glass-surface-styles';
    style.textContent = css;
    document.head.appendChild(style);
}

export function createGlassSurface(element, options = {}) {
    if (!element) return;

    const {
        borderRadius = 20,
        borderWidth = 0.07,
        brightness = 50,
        opacity = 0.93,
        blur = 11,
        backdropBlur = 0,
        displace = 0,
        backgroundOpacity = 0,
        saturation = 1,
        distortionScale = -180,
        redOffset = 0,
        greenOffset = 10,
        blueOffset = 20,
        xChannel = 'R',
        yChannel = 'G',
        mixBlendMode = 'difference',
    } = options;

    if (!supportsSVGFilters()) {
        element.classList.add('glass-surface', 'glass-surface--fallback');
        element.style.borderRadius = typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius;
        return;
    }

    element.classList.add('glass-surface', 'glass-surface--svg');
    element.style.borderRadius = typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius;
    element.style.setProperty('--glass-frost', backgroundOpacity);
    element.style.setProperty('--glass-saturation', saturation);
    element.style.setProperty('--glass-blur', typeof backdropBlur === 'number' ? `${backdropBlur}px` : backdropBlur);

    const uniqueId = Math.random().toString(36).substr(2, 9);
    const filterId = `glass-filter-${uniqueId}`;
    const redGradId = `red-grad-${uniqueId}`;
    const blueGradId = `blue-grad-${uniqueId}`;

    element.style.setProperty('--filter-id', `url(#${filterId})`);

    const generateDisplacementMap = (w, h) => {
        const actualWidth = w || 400;
        const actualHeight = h || 200;
        const edgeSize = Math.min(actualWidth, actualHeight) * (borderWidth * 0.5);

        const svgContent = `
          <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
                <stop offset="0%" stop-color="#0000"/>
                <stop offset="100%" stop-color="red"/>
              </linearGradient>
              <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#0000"/>
                <stop offset="100%" stop-color="blue"/>
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="black"></rect>
            <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${redGradId})" />
            <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode: ${mixBlendMode}" />
            <rect x="${edgeSize}" y="${edgeSize}" width="${actualWidth - edgeSize * 2}" height="${actualHeight - edgeSize * 2}" rx="${borderRadius}" fill="hsl(0 0% ${brightness}% / ${opacity})" style="filter:blur(${blur}px)" />
          </svg>
        `.trim();
        return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
    };

    const svgNS = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(svgNS, 'svg');
    svgEl.setAttribute('class', 'glass-surface__filter');
    svgEl.setAttribute('xmlns', svgNS);
    
    svgEl.innerHTML = `
        <defs>
          <filter id="${filterId}" color-interpolation-filters="sRGB" x="0%" y="0%" width="100%" height="100%">
            <feImage id="feImage-${uniqueId}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
            
            <feDisplacementMap in="SourceGraphic" in2="map" id="redchannel-${uniqueId}" result="dispRed" scale="${distortionScale + redOffset}" xChannelSelector="${xChannel}" yChannelSelector="${yChannel}" />
            <feColorMatrix in="dispRed" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red" />

            <feDisplacementMap in="SourceGraphic" in2="map" id="greenchannel-${uniqueId}" result="dispGreen" scale="${distortionScale + greenOffset}" xChannelSelector="${xChannel}" yChannelSelector="${yChannel}" />
            <feColorMatrix in="dispGreen" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green" />

            <feDisplacementMap in="SourceGraphic" in2="map" id="bluechannel-${uniqueId}" result="dispBlue" scale="${distortionScale + blueOffset}" xChannelSelector="${xChannel}" yChannelSelector="${yChannel}" />
            <feColorMatrix in="dispBlue" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue" />

            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" result="output" />
            <feGaussianBlur in="output" stdDeviation="${displace}" />
          </filter>
        </defs>
    `;

    const existingFilter = element.querySelector('.glass-surface__filter');
    if (existingFilter) existingFilter.remove();
    
    // Do NOT wrap content. Just insert filter SVG as first child.
    // Ensure parent position is relative or fixed or absolute for absolute child positioning
    // .glass-surface class adds position: relative.
    
    /* 
    // OLD WRAPPER LOGIC - REMOVED TO PRESERVE LAYOUT
    let contentWrapper = element.querySelector('.glass-surface__content');
    if (!contentWrapper) {
        contentWrapper = document.createElement('div');
        contentWrapper.className = 'glass-surface__content';
        while (element.firstChild) {
            contentWrapper.appendChild(element.firstChild);
        }
        element.appendChild(contentWrapper);
    }
    */

   // But if we insert before first child, filter is behind content?
   // SVG is z-index -1.
   // Content is auto.
   // So SVG should be behind.
    
    element.insertBefore(svgEl, element.firstChild);

    const updateMap = () => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const dataUrl = generateDisplacementMap(rect.width, rect.height);
        const feImage = svgEl.querySelector(`#feImage-${uniqueId}`);
        if (feImage) feImage.setAttribute('href', dataUrl);
    };

    setTimeout(updateMap, 0);

    const ro = new ResizeObserver(() => {
        requestAnimationFrame(() => setTimeout(updateMap, 0));
    });
    ro.observe(element);
    
    return () => {
        ro.disconnect();
    };
}
