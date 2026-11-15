import DeskLab from '@/components/desklab';
import {pageMetadata} from '../_metadata';

export const metadata = pageMetadata('/builder');

export default function Page() {
  return <DeskLab page="builder" />;
}
