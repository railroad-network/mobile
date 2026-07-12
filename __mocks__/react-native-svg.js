/**
 * Jest stand-in for `react-native-svg`, whose native module can't load under
 * Jest. Each SVG primitive renders as a plain View so component trees that use
 * SVG (e.g. the StarMark brand icon) render without touching native code.
 */
const React = require('react');
const {View} = require('react-native');

const stub = name => {
  const Component = ({children, ...props}) =>
    React.createElement(View, {...props, testID: props.testID ?? name}, children);
  Component.displayName = name;
  return Component;
};

const Svg = stub('Svg');
module.exports = Svg;
module.exports.default = Svg;
module.exports.Svg = Svg;
for (const name of [
  'Path',
  'Circle',
  'Rect',
  'G',
  'Defs',
  'LinearGradient',
  'Stop',
  'ClipPath',
  'Line',
  'Polygon',
  'Polyline',
  'Text',
  'Ellipse',
]) {
  module.exports[name] = stub(name);
}
