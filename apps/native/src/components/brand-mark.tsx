import { Image } from "expo-image";

// The Paper Pairings mark: a folded-corner sheet holding a bracket, the same
// glyph as the web's BrandMark (apps/web/src/components/shared/brand-mark.tsx).
// The app is always dark, so only the knockout variant ships, rasterised in
// paper white on transparent by scripts/render-brand-assets.mjs alongside the
// launcher and splash images; rerun it when the mark changes.
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <Image
      source={require("../../assets/images/brand-mark.png")}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessible={false}
    />
  );
}
