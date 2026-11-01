import React from 'react';
import { createRoot } from 'react-dom/client';
import brandLogo from '../../brand/rudra-creative-logo.png';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AccountPage, CustomPrintPage, HomePage, LegalPage, ProductPage, ShopPage, VerifyPage } from './pages';
import { CartPage, CheckoutPage, PaymentResultPage } from './commerce-pages';
import './styles.css';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = brandLogo;
if (!favicon.isConnected) document.head.append(favicon);

function NotFound() { return <section className="page-wrap not-found"><span className="eyebrow eyebrow--dark"><span /> 404 / OFF THE MAP</span><h1>Nothing to<br /><em>see here.</em></h1><p>This page doesn't exist or may have moved.</p><a className="button button--gold" href="/">Return home ↗</a></section>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Routes><Route element={<Layout />}><Route index element={<HomePage />} /><Route path="shop" element={<ShopPage />} /><Route path="products/:slug" element={<ProductPage />} /><Route path="cart" element={<CartPage />} /><Route path="checkout" element={<CheckoutPage />} /><Route path="payment/result" element={<PaymentResultPage />} /><Route path="custom-print" element={<CustomPrintPage />} /><Route path="account" element={<AccountPage />} /><Route path="verify" element={<VerifyPage />} /><Route path="legal/:slug" element={<LegalPage />} /><Route path="*" element={<NotFound />} /></Route></Routes></BrowserRouter></React.StrictMode>);
