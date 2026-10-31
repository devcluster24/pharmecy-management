import Constants, { AppOwnership } from 'expo-constants';

export const OCR_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_OCR !== 'false'
  && Constants.appOwnership !== AppOwnership.Expo;

export async function recognizeText(imageUri: string) {
  const { default: TextRecognition } = await import('@react-native-ml-kit/text-recognition');
  return TextRecognition.recognize(imageUri);
}
