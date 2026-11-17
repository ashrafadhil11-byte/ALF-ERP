import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { hrefFor, type PageFile } from '../lib/pages';

/** A link to an ERP page: in-app navigation when that page is already React, a normal link to the old page otherwise. */
export function PageLink({ page, children, ...rest }: { page: PageFile; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
    const target = hrefFor(page);
    return 'to' in target
        ? <Link to={target.to} {...rest}>{children}</Link>
        : <a href={target.href} {...rest}>{children}</a>;
}
