//js/gestures.js
// Touch gesture handling for mobile devices

export function initializeGestures(player) {
    const playerBar = document.querySelector('.now-playing-bar');
    const mobileControls = document.querySelector('.mobile-player-controls');
    
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    const minSwipeDistance = 50;
    const maxVerticalDistance = 100;
    
    // Only initialize gestures on mobile/touch devices
    if (!('ontouchstart' in window)) return;
    
    // Swipe detection on the player bar
    const handleTouchStart = (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    };
    
    const handleTouchEnd = (e) => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipeGesture();
    };
    
    const handleSwipeGesture = () => {
        const horizontalDistance = touchEndX - touchStartX;
        const verticalDistance = Math.abs(touchEndY - touchStartY);
        
        // Only handle horizontal swipes (not vertical scrolls)
        if (verticalDistance > maxVerticalDistance) return;
        
        // Swipe left = Next track
        if (horizontalDistance < -minSwipeDistance) {
            player.next();
            showGestureIndicator('→ Next');
        }
        
        // Swipe right = Previous track
        if (horizontalDistance > minSwipeDistance) {
            player.previous();
            showGestureIndicator('← Previous');
        }
    };
    
    // Apply gesture listeners to player bar
    if (playerBar) {
        playerBar.addEventListener('touchstart', handleTouchStart, { passive: true });
        playerBar.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    
    // Apply gesture listeners to mobile controls
    if (mobileControls) {
        mobileControls.addEventListener('touchstart', handleTouchStart, { passive: true });
        mobileControls.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    
    // Pull to refresh on main content
    initializePullToRefresh();
    
    // Long press for track items
    initializeLongPress();
}

function showGestureIndicator(text) {
    // Create a brief visual indicator
    const existing = document.querySelector('.gesture-indicator');
    if (existing) existing.remove();
    
    const indicator = document.createElement('div');
    indicator.className = 'gesture-indicator';
    indicator.textContent = text;
    indicator.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 500;
        z-index: 10000;
        pointer-events: none;
        animation: fadeInOut 0.6s ease forwards;
    `;
    
    document.body.appendChild(indicator);
    
    setTimeout(() => indicator.remove(), 600);
}

function initializePullToRefresh() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    
    let startY = 0;
    let currentY = 0;
    let isPulling = false;
    const threshold = 80;
    
    mainContent.addEventListener('touchstart', (e) => {
        if (mainContent.scrollTop === 0) {
            startY = e.touches[0].pageY;
            isPulling = true;
        }
    }, { passive: true });
    
    mainContent.addEventListener('touchmove', (e) => {
        if (!isPulling) return;
        currentY = e.touches[0].pageY;
        const pullDistance = currentY - startY;
        
        if (pullDistance > 0 && pullDistance < threshold * 2) {
            // Visual feedback could be added here
        }
    }, { passive: true });
    
    mainContent.addEventListener('touchend', () => {
        if (!isPulling) return;
        
        const pullDistance = currentY - startY;
        if (pullDistance > threshold) {
            // Trigger refresh based on current page
            const hash = window.location.hash;
            if (hash === '#home' || hash === '') {
                window.dispatchEvent(new CustomEvent('refresh-home'));
            } else if (hash === '#library') {
                window.dispatchEvent(new CustomEvent('library-changed'));
            } else if (hash === '#recent') {
                window.dispatchEvent(new CustomEvent('history-changed'));
            }
            
            showGestureIndicator('↓ Refreshing...');
        }
        
        isPulling = false;
        startY = 0;
        currentY = 0;
    }, { passive: true });
}

function initializeLongPress() {
    const longPressDuration = 500; // ms
    let longPressTimer = null;
    let isLongPress = false;
    
    document.addEventListener('touchstart', (e) => {
        const trackItem = e.target.closest('.track-item');
        if (!trackItem) return;
        
        isLongPress = false;
        longPressTimer = setTimeout(() => {
            isLongPress = true;
            
            // Trigger context menu or quick actions
            const contextMenu = document.getElementById('context-menu');
            if (contextMenu) {
                // Get track data and show context menu
                const touch = e.touches[0];
                contextMenu.style.left = `${touch.clientX}px`;
                contextMenu.style.top = `${touch.clientY}px`;
                
                // Vibrate if supported
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
                
                // The context menu will be populated by existing contextmenu handling
                // Just trigger the menu display
                const event = new MouseEvent('contextmenu', {
                    bubbles: true,
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                trackItem.dispatchEvent(event);
            }
        }, longPressDuration);
    }, { passive: true });
    
    document.addEventListener('touchend', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: true });
    
    document.addEventListener('touchmove', () => {
        // Cancel long press if user moves finger
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: true });
}

// CSS for gesture indicator animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInOut {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
    }
`;
document.head.appendChild(style);
