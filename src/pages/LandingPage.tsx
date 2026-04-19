import { useParams, Navigate, Link } from 'react-router-dom';
import SEO from '../components/SEO';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import seoTargets from '../data/seo-targets.json';
import { CheckCircle2, DollarSign, PieChart, Shield } from 'lucide-react';

export default function LandingPage() {
    const { slug } = useParams<{ slug: string }>();
    const pageData = seoTargets.find(t => t.slug === slug);

    if (!pageData) {
        return <Navigate to="/" replace />;
    }

    return (
        <div className="bg-white dark:bg-gray-900 min-h-dvh-safe text-gray-800 dark:text-gray-200">
            <SEO
                title={pageData.title}
                description={pageData.description}
                canonical={`/${slug}`}
            />

            {/* Navbar */}
            <Navbar />

            {/* Hero Section */}
            <header className="py-20 px-6 text-center">
                <div className="container mx-auto max-w-4xl">
                    <span className="inline-block px-3 py-1 mb-6 text-sm font-semibold text-green-800 bg-green-100 rounded-full dark:bg-green-900/30 dark:text-green-300">
                        {pageData.keyword}
                    </span>
                    <h1 className="text-4xl md:text-6xl font-extrabold text-gray-900 dark:text-white mb-6 leading-tight">
                        {pageData.title}
                    </h1>
                    <p className="text-xl text-gray-600 dark:text-gray-400 mb-10 max-w-2xl mx-auto">
                        {(pageData as any).hero_subtitle || pageData.description}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link to="/signup" className="inline-flex items-center justify-center px-8 py-4 text-lg font-bold text-white transition-all bg-green-600 rounded-lg hover:bg-green-700 hover:shadow-lg transform hover:-translate-y-1">
                            Get Started for Free
                        </Link>
                        <Link to="/info" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-800 dark:text-white dark:border-gray-700 dark:hover:bg-gray-700">
                            Learn More
                        </Link>
                    </div>
                </div>
            </header>

            {/* Feature Highlights */}
            <section className="py-16 bg-gray-50 dark:bg-gray-800/50">
                <div className="container mx-auto px-6 max-w-6xl">
                    <div className="grid md:grid-cols-3 gap-8">
                        {/* Feature 1 */}
                        <div className="p-8 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mb-6">
                                <DollarSign className="w-6 h-6 text-green-600" />
                            </div>
                            <h3 className="text-xl font-bold mb-3">{(pageData as any).features?.[0]?.title || "100% Free to Use"}</h3>
                            <p className="text-gray-600 dark:text-gray-400">
                                {(pageData as any).features?.[0]?.description || `Perfect for ${pageData.slug.replace('-', ' ')}. No subscriptions, no ads.`}
                            </p>
                        </div>
                        {/* Feature 2 */}
                        <div className="p-8 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-6">
                                <Shield className="w-6 h-6 text-blue-600" />
                            </div>
                            <h3 className="text-xl font-bold mb-3">{(pageData as any).features?.[1]?.title || "Private & Secure"}</h3>
                            <p className="text-gray-600 dark:text-gray-400">
                                {(pageData as any).features?.[1]?.description || "Your data stays on your device. We use industry-standard encryption."}
                            </p>
                        </div>
                        {/* Feature 3 */}
                        <div className="p-8 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center mb-6">
                                <PieChart className="w-6 h-6 text-purple-600" />
                            </div>
                            <h3 className="text-xl font-bold mb-3">{(pageData as any).features?.[2]?.title || "Smart Analytics"}</h3>
                            <p className="text-gray-600 dark:text-gray-400">
                                {(pageData as any).features?.[2]?.description || "Visualize your spending habits with beautiful charts."}
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Unique Value Prop Section */}
            {(pageData as any).unique_blurb && (
                <section className="py-20">
                    <div className="container mx-auto px-6 max-w-4xl text-center">
                        <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
                            Why Traxos for {pageData.slug.replace('-', ' ')}?
                        </h2>
                        <p className="text-xl text-gray-600 dark:text-gray-300 leading-relaxed">
                            {(pageData as any).unique_blurb}
                        </p>
                    </div>
                </section>
            )}

            {/* Trust Section */}
            <section className="py-20 text-center">
                <div className="container mx-auto px-6">
                    <h2 className="text-3xl font-bold mb-12">Why Users Trust Traxos</h2>
                    <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto text-left">
                        {[
                            'Zero monthly fees or hidden costs',
                            'Secure cloud synchronization',
                            'Export data to CSV/PDF anytime',
                            'Dark mode included out of the box'
                        ].map((item, i) => (
                            <div key={i} className="flex items-start">
                                <CheckCircle2 className="w-6 h-6 text-green-500 mr-4 flex-shrink-0" />
                                <span className="text-lg text-gray-700 dark:text-gray-300">{item}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="py-20 bg-green-600 text-center text-white">
                <div className="container mx-auto px-6">
                    <h2 className="text-3xl md:text-4xl font-bold mb-6">Ready to take control?</h2>
                    <p className="text-xl mb-10 text-green-100">Join thousands of users managing their finances smarter.</p>
                    <Link to="/signup" className="inline-block px-10 py-4 bg-white text-green-700 font-bold rounded-lg hover:bg-gray-100 transition-colors shadow-lg">
                        Start Tracking Now
                    </Link>
                </div>
            </section>

            <Footer />
        </div>
    );
}
