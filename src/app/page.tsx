import DeskLab from '@/components/desklab';
import {pageMetadata} from './_metadata';

export const metadata = pageMetadata('/');

export default function Page() {
  return <DeskLab page="home" />;
}
