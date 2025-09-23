
(function injectCartDrawer() {
  // prevent double-inject
  if (document.querySelector('#cart-drawer')) return;

  const cartHTML = `
 <!-- Cart drawer (drawer open/close controlled by index.js / navbar.js) --> <aside id="cart-drawer" class="drawer" aria-hidden="true"> <div class="drawer-header"> <h2 data-translate="index.cart.yourCart">Your cart</h2> <button id="btn-close-cart" class="icon-btn" aria-label="Close cart">✖</button> </div> <div id="cart-items" class="cart-list" role="list" aria-live="polite"></div> <div class="drawer-footer"> <div class="total"> <span data-translate="index.cart.total">Total</span> <strong id="cart-total">$0.00</strong> </div> <button id="btn-checkout" class="btn wide" data-translate="index.cart.checkout">Checkout</button> </div> </aside> <!-- Scrim placed after drawer for stacking with CSS sibling rules --> <div id="scrim" class="scrim" hidden></div>
  `;

  // put it at the end of <body>
  document.body.insertAdjacentHTML('beforeend', cartHTML);
})();



