/**
 * Jest mock for @shopify/flash-list — the real list relies on native layout
 * measurement that doesn't happen under react-test-renderer, so items wouldn't
 * render. This stand-in renders every `data` entry through `renderItem` (and the
 * empty component when there's nothing), which is all the screen tests need to
 * assert on rows, headers, and empty states. The sticky-header / recycling
 * behaviour is native and out of scope for these tests.
 */
const React = require('react');
const {View} = require('react-native');

function FlashList({data, renderItem, keyExtractor, ListEmptyComponent, ...rest}) {
  const items = data ?? [];
  if (items.length === 0) {
    return React.createElement(View, null, ListEmptyComponent ?? null);
  }
  return React.createElement(
    View,
    null,
    items.map((item, index) => {
      const key = keyExtractor ? keyExtractor(item, index) : String(index);
      return React.createElement(
        View,
        {key},
        renderItem ? renderItem({item, index, target: 'Cell', extraData: rest.extraData}) : null,
      );
    }),
  );
}

module.exports = {
  __esModule: true,
  FlashList,
  AnimatedFlashList: FlashList,
};
