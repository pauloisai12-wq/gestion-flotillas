# Frontend Performance Checklist

- Review only changed frontend files and directly related components/hooks.
- Check unnecessary client components, hydration-heavy state, and large client-only dependencies.
- Prefer server rendering/data fetching where it matches the existing app structure.
- Check image/font/resource loading and bundle impact for changed routes.
- Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` when relevant.
