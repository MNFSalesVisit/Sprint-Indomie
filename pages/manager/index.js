// Manager module — reuses the Admin portal component.
// The component uses `role === 'Manager'` internally to:
//   - Show all regions (no region restriction)
//   - Hide Uplift Approvals tab
//   - Render Targets and Fuel Management in read-only mode
//   - Show a region filter dropdown in the topbar
export { default } from '../admin/index';
