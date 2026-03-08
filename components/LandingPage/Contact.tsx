"use client";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Mail, Phone, MapPin } from "lucide-react";
import { useState } from "react";

export function Contact() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    message: "",
  });

  // ... (imports and state declaration unchanged) ...

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // 1. Send the form data to your Next.js API Route
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      // 2. Handle the API response
      if (response.ok) {
        // Successful submission
        const result = await response.json();
        console.log("Submission successful:", result.message);
        
        // Show success message to the user
        alert("✅ Thank you for your interest! We'll get back to you soon.");
        
        // Clear the form
        setFormData({ name: "", email: "", company: "", message: "" });
        
      } else {
        // Submission failed (e.g., 500 server error)
        const errorData = await response.json();
        console.error("Submission failed:", errorData.message);
        alert(`❌ Submission failed: ${errorData.message}`);
      }
    } catch (error) {
      // Network error (e.g., server offline)
      console.error("Network error during submission:", error);
      alert("❌ A network error occurred. Please try again later.");
    }
  };

// ... (rest of the component unchanged) ...

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <section id="contact" className="py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl text-[var(--dtg-teal)] mb-4">Get In Touch</h2>
          <p className="max-w-2xl mx-auto">
            Ready to transform your geotechnical projects? Contact us to learn more about our digital twin solutions.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 max-w-6xl mx-auto">
          {/* Contact Form */}
          <Card className="border-[var(--border)]">
            <CardHeader>
              <CardTitle className="text-[var(--foreground)] font-semibold">Send Us a Message</CardTitle>
              <CardDescription className="text-[var(--muted-foreground)]">
                Fill out the form and we'll get back to you within 24 hours
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Input
                    name="name"
                    placeholder="Your Name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className="border-[var(--border)] hover:bg-teal-500/20 hover:border-teal-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-teal-500/10"
                  />
                </div>
                <div>
                  <Input
                    name="email"
                    type="email"
                    placeholder="Your Email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className="border-[var(--border)] hover:bg-teal-500/20 hover:border-teal-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-teal-500/10"
                  />
                </div>
                <div>
                  <Input
                    name="company"
                    placeholder="Company Name"
                    value={formData.company}
                    onChange={handleChange}
                    className="border-[var(--border)] hover:bg-teal-500/20 hover:border-teal-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-teal-500/10"
                  />
                </div>
                <div>
                  <Textarea
                    name="message"
                    placeholder="Tell us about your project..."
                    value={formData.message}
                    onChange={handleChange}
                    required
                    rows={5}
                    className="border-[var(--border)] hover:bg-teal-500/20 hover:border-teal-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-teal-500/10"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                >
                  Send Message
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <div className="space-y-6">
            <Card className="border-[var(--border)] hover:bg-teal-500/20 hover:border-teal-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-teal-500/10">
              <CardContent className="flex items-start gap-4 pt-6">
                <div className="w-12 h-12 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-6 h-6 text-teal-600" />
                </div>
                <div>
                  <div className="text-[var(--muted-foreground)] mb-1">Email</div>
                  <p>info@dtgeotech.com</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[var(--border)] hover:bg-teal-500/20 hover:border-teal-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-teal-500/10">
              <CardContent className="flex items-start gap-4 pt-6">
                <div className="w-12 h-12 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                  <Phone className="w-6 h-6 text-teal-600" />
                </div>
                <div>
                  <div className="text-[var(--muted-foreground)] mb-1">Phone</div>
                  <p>+62 811-2701-2626</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[var(--border)] hover:bg-teal-500/20 hover:border-teal-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-teal-500/10">
              <CardContent className="flex items-start gap-4 pt-6">
                <div className="w-12 h-12 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-6 h-6 text-teal-600" />
                </div>
                <div>
                  <div className="text-[var(--muted-foreground)] mb-1">Office</div>
                  <p>
                    Jl. Besi-Jangkang No. 9b, Sukoharjo,<br />
                    Ngaglik, Sleman, Yogyakarta, Indonesia 55581
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="bg-gradient-to-br from-teal-500/20 to-transparent border border-[var(--border)] rounded-lg p-6">
              <p className="mb-4">
                Looking for immediate assistance? Our team is available Monday through Friday, 9 AM - 6 PM PST.
              </p>
              <p className="text-teal-600">
                For urgent inquiries, please call our 24/7 support line.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}