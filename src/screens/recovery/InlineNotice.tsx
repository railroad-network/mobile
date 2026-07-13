/**
 * InlineNotice — the recovery flow's original name for the shared {@link Banner}
 * primitive. Kept as a thin re-export so the recovery and holder-receive screens
 * that import `InlineNotice` / `NoticeVariant` keep working, while there is a
 * single implementation (`components/Banner`). Prefer `Banner` in new code.
 */
export {Banner as InlineNotice} from '../../components';
export type {BannerVariant as NoticeVariant, BannerProps as InlineNoticeProps} from '../../components';
