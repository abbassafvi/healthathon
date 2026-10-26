// Each test starts with empty device storage.
afterEach(async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage')
  await AsyncStorage.clear()
})

// A cold run transforms every file first; one second is too tight then.
require('@testing-library/react-native').configure({ asyncUtilTimeout: 3000 })
