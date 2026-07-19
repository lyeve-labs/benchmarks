import config from '@payload-config';
import '@payloadcms/next/css';
import { RootLayout } from '@payloadcms/next/layouts';
import React from 'react';
import { importMap } from './admin/importMap.js';

type Args = { children: React.ReactNode };

const Layout = ({ children }: Args) => (
  <RootLayout config={config} importMap={importMap}>
    {children}
  </RootLayout>
);

export default Layout;
