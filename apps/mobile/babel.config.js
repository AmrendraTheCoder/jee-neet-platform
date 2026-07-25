// Reanimated 4 runs on react-native-worklets, whose Babel plugin MUST be last.
// Without it every animated style silently falls back to the JS thread, which is
// invisible on a development machine and janky on the 4 GB Android baseline this
// client targets.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
