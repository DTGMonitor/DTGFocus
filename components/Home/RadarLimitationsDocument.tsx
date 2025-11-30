import React, { useState } from 'react';
import {
  Shield,
  FileText,
  AlertTriangle,
  X,
  Printer,
  Download,
  CheckSquare,
  Square,
  Eye,
  Mountain,
  Leaf,
  Radio,
  TrendingDown,
  Clock,
  Users
} from 'lucide-react';
import { Button } from '@/components/LandingPage/ui/button';
import { Checkbox } from '@/components/LandingPage/ui/checkbox';
import limitationImage1 from '@/src/images/limitation/b9ae0251babd4dc0a02187b15f93c633f2b5e87f.png';
import limitationImage2 from '@/src/images/limitation/693a7d2dd100963ec5d6d68ba6759a0c2f97213d.png';
import limitationImage3 from '@/src/images/limitation/fa6702655fe189fe070e2d1a0fda9a29fc9bcf52.png';
import Image from 'next/image';

interface RadarLimitationsDocumentProps {
  radarName: string;
  onClose: () => void;
}

interface Acknowledgement {
  id: string;
  acknowledged: boolean;
  clientSignature?: string;
  acknowledgedDate?: string;
  acknowledgedBy?: string;
}

const limitationsData = {
  metadata: {
    version: "3.0",
    classification: "TECHNICAL LIMITATIONS",
    lastUpdated: "March 8, 2025",
    clientName: "PT. Insani Baraperkasa",
    systemType: "GroundProbe SSR Radar"
  },
  limitations: [
    {
      id: 'size-of-collapse',
      title: 'Size of Collapse',
      icon: Mountain,
      description: 'Pixel size and resolution limitations affecting detection capabilities',
      technicalLimitations: [
        'Pixel size/resolution (for RAR) is a function of antenna size and distance from the slope.',
        'Slope movements smaller than 2 pixels cannot be reliably measured.'
      ],
      image: limitationImage1,
      acknowledgementText: 'The customer understands the limitation of the technology and agrees that collapses less than 2 times pixel size (surface area) may not be detected or reported by the GSS-Local engineers.',
      detailsText: 'Detection limit is directly proportional to range and inversely proportional to antenna size. At 1000m range, minimum detectable movement is typically 8mm for bench scale failures.'
    },
    {
      id: 'rapid-brittle-collapse',
      title: 'Rapid Brittle Collapse "Rock Fall"',
      icon: TrendingDown,
      description: 'Limitations in detecting sudden failure events with minimal precursor movement',
      technicalLimitations: [
        'Rapid brittle failures (depending on scale and mechanism) may show little to no precursor deformation/movement.',
        'Vector loss and size of collapse may also influence the "no precursor deformation/movement".'
      ],
      image: limitationImage2,
      acknowledgementText: 'The customer understands the limitation of the technology and agrees that small or \'rapid brittle\' type failures may not display adequate precursor movement to allow for detection and notification.',
      additionalAcknowledgement: 'In this event, the customer may be notified after the event that a drop in coherence suggests there has been some collapse of material.',
      detailsText: 'Brittle failure mechanisms typically show <24 hours of precursor movement, making prediction extremely challenging even with continuous monitoring.'
    },
    {
      id: 'vegetation-materials',
      title: 'Vegetation, Snow, Water, Loose Materials',
      icon: Leaf,
      description: 'Environmental factors affecting radar signal quality and reliability',
      technicalLimitations: [
        'Areas covered by vegetation, snow, water, or loose rock material are generally not suitable for monitoring with radar as it may result in unreliable results and data contamination.'
      ],
      image: limitationImage3,
      acknowledgementText: 'The customer understands and acknowledges that attempting to monitor slopes that are covered by vegetation or other materials as above can be problematic or even impossible with radar.',
      additionalAcknowledgement: 'There is a risk that instability on slopes covered by vegetation or snow etc may not be detected and reported by the GSS-Remote engineers due to data uncertainty caused by low surface coherence.',
      detailsText: 'Coherence values below 0.3 indicate unreliable data. Vegetation causes decorrelation due to wind movement and seasonal changes.'
    },
    {
      id: 'atmospheric-conditions',
      title: 'Atmospheric Conditions',
      icon: Eye,
      description: 'Weather-related limitations affecting radar performance',
      technicalLimitations: [
        'Heavy rain, fog, or extreme atmospheric conditions can affect radar signal propagation.',
        'Temperature variations can cause atmospheric refraction affecting measurement accuracy.',
        'High winds may cause antenna movement affecting data quality.'
      ],
      acknowledgementText: 'The customer understands that severe weather conditions including heavy rain, fog, or extreme temperatures may temporarily affect radar performance and data quality.',
      detailsText: 'Atmospheric effects are typically <5mm error but can increase during severe weather events. System includes automatic weather compensation algorithms.'
    },
    {
      id: 'line-of-sight',
      title: 'Line of Sight Limitations',
      icon: Radio,
      description: 'Physical obstruction limitations affecting radar coverage',
      technicalLimitations: [
        'Radar requires direct line of sight to the monitored area.',
        'Areas shadowed by topographic features cannot be monitored.',
        'Oblique viewing angles reduce measurement sensitivity.'
      ],
      acknowledgementText: 'The customer acknowledges that radar monitoring requires direct line of sight and that areas blocked by terrain features or structures cannot be effectively monitored.',
      detailsText: 'Optimal viewing angles are 15-75° from perpendicular. Areas beyond these angles may show reduced sensitivity or complete data loss.'
    },
    {
      id: 'temporal-resolution',
      title: 'Temporal Resolution',
      icon: Clock,
      description: 'Time-based limitations in detection and response capabilities',
      technicalLimitations: [
        'Measurement frequency is limited by system scanning intervals.',
        'Very rapid movements between scans may not be fully captured.',
        'System requires minimum observation time for reliable trend analysis.'
      ],
      acknowledgementText: 'The customer understands that radar measurements are taken at discrete intervals and that extremely rapid movements occurring between measurement cycles may not be fully documented.',
      detailsText: 'Standard scanning interval is 1-15 minutes depending on configuration. Minimum 24-48 hours of data required for reliable velocity trend analysis.'
    }
  ]
};

export function RadarLimitationsDocument({ radarName, onClose }: RadarLimitationsDocumentProps) {
  const [acknowledgements, setAcknowledgements] = useState<{ [key: string]: Acknowledgement }>({});
  const [clientRepresentative, setClientRepresentative] = useState('');
  const [signatureDate, setSignatureDate] = useState(new Date().toISOString().split('T')[0]);

  const handleAcknowledgement = (limitationId: string, acknowledged: boolean) => {
    setAcknowledgements(prev => ({
      ...prev,
      [limitationId]: {
        id: limitationId,
        acknowledged,
        acknowledgedDate: acknowledged ? new Date().toISOString() : undefined,
        acknowledgedBy: acknowledged ? clientRepresentative : undefined
      }
    }));
  };

  const handlePrint = () => {
    window.print();
  };

  const allAcknowledged = limitationsData.limitations.every(
    limitation => acknowledgements[limitation.id]?.acknowledged
  );

  const acknowledgedCount = Object.values(acknowledgements).filter(ack => ack.acknowledged).length;

  return (
    <>
      {/* Floating Header */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center justify-between p-4 max-w-7xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-orange-600 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-white">Radar Limitations Document</h1>
              <p className="text-xs text-gray-400">{radarName} - {acknowledgedCount}/{limitationsData.limitations.length} acknowledged</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className="text-right mr-4">
              <div className="text-sm text-white font-medium">
                {allAcknowledged ? 'All Limitations Acknowledged' : 'Pending Acknowledgements'}
              </div>
              <div className={`text-xs ${allAcknowledged ? 'text-green-400' : 'text-orange-400'}`}>
                {acknowledgedCount}/{limitationsData.limitations.length} complete
              </div>
            </div>
            <Button
              size="sm"
              onClick={handlePrint}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
              disabled={!allAcknowledged}
            >
              <Download className="w-4 h-4 mr-1" />
              Export
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="text-white hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Document Content */}
      <div className="min-h-screen bg-black text-white pt-16">
        <div className="max-w-6xl mx-auto px-6 py-8">

          {/* Hero Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center space-x-2 bg-orange-500/10 border border-orange-500/20 rounded-full px-4 py-2 mb-6">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              <span className="text-orange-400 text-sm font-medium">TECHNICAL LIMITATIONS</span>
            </div>

            <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
              Radar System Limitations
            </h1>
            <div className="space-y-1 mb-6">
              <p className="text-xl text-gray-300">Understanding Technology Constraints</p>
              <p className="text-gray-400">{limitationsData.metadata.clientName}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto text-sm">
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="text-blue-400 font-medium">System</div>
                <div className="text-white text-xs">{limitationsData.metadata.systemType}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="text-green-400 font-medium">Applied to</div>
                <div className="text-white text-xs">{radarName}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="text-orange-400 font-medium">Version</div>
                <div className="text-white">{limitationsData.metadata.version}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="text-purple-400 font-medium">Updated</div>
                <div className="text-white text-xs">{limitationsData.metadata.lastUpdated}</div>
              </div>
            </div>
          </div>

          {/* Client Representative Input */}
          <div className="mb-12">
            <div className="bg-gradient-to-r from-blue-500/10 to-blue-600/10 border border-blue-500/20 rounded-xl p-6">
              <h3 className="text-lg font-bold text-blue-300 mb-4 flex items-center">
                <Users className="w-5 h-5 mr-2" />
                Client Representative Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Authorized Representative Name
                  </label>
                  <input
                    type="text"
                    value={clientRepresentative}
                    onChange={(e) => setClientRepresentative(e.target.value)}
                    className="w-full px-4 py-2 bg-black/20 border border-white/20 rounded-lg text-white placeholder-gray-400"
                    placeholder="Enter full name of person acknowledging limitations"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Acknowledgement Date
                  </label>
                  <input
                    type="date"
                    value={signatureDate}
                    onChange={(e) => setSignatureDate(e.target.value)}
                    className="w-full px-4 py-2 bg-black/20 border border-white/20 rounded-lg text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Limitations */}
          <div className="space-y-12">
            {limitationsData.limitations.map((limitation, index) => {
              const IconComponent = limitation.icon;
              const isAcknowledged = acknowledgements[limitation.id]?.acknowledged || false;

              return (
                <div key={limitation.id} className="bg-gradient-to-r from-gray-900/80 to-gray-800/80 border border-gray-700/50 rounded-2xl overflow-hidden">
                  {/* Header */}
                  <div className="p-6 border-b border-gray-700/50">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center">
                          <IconComponent className="w-6 h-6 text-orange-400" />
                        </div>
                        <div>
                          <h2 className="text-2xl font-bold text-white">
                            {index + 1}. {limitation.title}
                          </h2>
                          <p className="text-gray-400">{limitation.description}</p>
                        </div>
                      </div>
                      <div className={`flex items-center space-x-2 px-4 py-2 rounded-full ${isAcknowledged ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'
                        }`}>
                        {isAcknowledged ? (
                          <>
                            <CheckSquare className="w-4 h-4" />
                            <span className="text-sm font-medium">Acknowledged</span>
                          </>
                        ) : (
                          <>
                            <Square className="w-4 h-4" />
                            <span className="text-sm font-medium">Pending</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                      {/* Limitations Section */}
                      <div>
                        <div className="mb-6">
                          <h3 className="text-lg font-bold text-orange-400 mb-4 bg-orange-500/10 inline-block px-3 py-1 rounded-lg">
                            LIMITATIONS
                          </h3>
                          <div className="space-y-3">
                            {limitation.technicalLimitations.map((item, itemIndex) => (
                              <div key={itemIndex} className="flex items-start space-x-3">
                                <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 flex-shrink-0"></div>
                                <p className="text-gray-300 leading-relaxed">{item}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Technical Details */}
                        {limitation.detailsText && (
                          <div className="bg-black/20 rounded-lg p-4 border border-gray-600/30">
                            <h4 className="text-sm font-medium text-gray-400 mb-2">Technical Details:</h4>
                            <p className="text-sm text-gray-400">{limitation.detailsText}</p>
                          </div>
                        )}

                        {/* Image if available */}
                        {limitation.image && (
                          <div className="mt-6">
                            <Image
                              src={limitation.image}
                              alt={`${limitation.title} diagram`}
                              // You MUST provide width and height props, or set layout="fill"
                              width={500} // Example values
                              height={300} // Example values
                              className="w-full rounded-lg border border-gray-600/30"
                            />
                          </div>
                        )}
                      </div>

                      {/* Acknowledgement Section */}
                      <div>
                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-6">
                          <h3 className="text-lg font-bold text-orange-400 mb-4 bg-orange-500/20 inline-block px-3 py-1 rounded-lg">
                            ACKNOWLEDGEMENT
                          </h3>

                          <div className="space-y-4">
                            <div className="bg-black/20 rounded-lg p-4">
                              <p className="text-gray-200 leading-relaxed italic">
                                "{limitation.acknowledgementText}"
                              </p>

                              {limitation.additionalAcknowledgement && (
                                <p className="text-gray-200 leading-relaxed italic mt-3">
                                  "{limitation.additionalAcknowledgement}"
                                </p>
                              )}
                            </div>

                            {/* Acknowledgement Checkbox */}
                            <div className="border-t border-gray-600/30 pt-4">
                              <div className="flex items-center space-x-3 mb-4">
                                <Checkbox
                                  id={`ack-${limitation.id}`}
                                  checked={isAcknowledged}
                                  onCheckedChange={(checked) =>
                                    handleAcknowledgement(limitation.id, checked as boolean)
                                  }
                                  disabled={!clientRepresentative.trim()}
                                  className="w-5 h-5 border-2 border-orange-400 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                                />
                                <label
                                  htmlFor={`ack-${limitation.id}`}
                                  className={`text-sm font-medium cursor-pointer ${!clientRepresentative.trim() ? 'text-gray-500' : 'text-white'
                                    }`}
                                >
                                  I acknowledge and understand this limitation
                                </label>
                              </div>

                              {isAcknowledged && (
                                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                                  <div className="text-xs text-green-400 space-y-1">
                                    <div><strong>Acknowledged by:</strong> {acknowledgements[limitation.id]?.acknowledgedBy}</div>
                                    <div><strong>Date:</strong> {acknowledgements[limitation.id]?.acknowledgedDate ?
                                      new Date(acknowledgements[limitation.id]!.acknowledgedDate!).toLocaleString() : ''}</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Final Acknowledgement Summary */}
          <div className="mt-16 border-t border-gray-700 pt-8">
            <div className={`bg-gradient-to-r rounded-xl p-8 text-center ${allAcknowledged
                ? 'from-green-900/30 to-green-800/30 border border-green-500/30'
                : 'from-gray-900/30 to-gray-800/30 border border-gray-500/30'
              }`}>
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${allAcknowledged ? 'bg-green-500' : 'bg-gray-500'
                }`}>
                {allAcknowledged ? (
                  <CheckSquare className="w-8 h-8 text-white" />
                ) : (
                  <FileText className="w-8 h-8 text-white" />
                )}
              </div>

              <h3 className={`text-xl font-bold mb-2 ${allAcknowledged ? 'text-green-300' : 'text-gray-300'
                }`}>
                {allAcknowledged ? 'Document Complete' : 'Acknowledgements Required'}
              </h3>

              <p className={`mb-4 ${allAcknowledged ? 'text-green-200' : 'text-gray-400'
                }`}>
                {allAcknowledged
                  ? `All ${limitationsData.limitations.length} limitations have been acknowledged by ${clientRepresentative}. This document is ready for export and filing.`
                  : `Please review and acknowledge all limitations before completing this document. ${acknowledgedCount}/${limitationsData.limitations.length} completed.`
                }
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto text-sm">
                <div className="bg-black/20 rounded-lg p-3">
                  <div className="text-gray-400">Total Limitations</div>
                  <div className="text-white font-bold">{limitationsData.limitations.length}</div>
                </div>
                <div className="bg-black/20 rounded-lg p-3">
                  <div className="text-gray-400">Acknowledged</div>
                  <div className={`font-bold ${allAcknowledged ? 'text-green-400' : 'text-orange-400'}`}>
                    {acknowledgedCount}
                  </div>
                </div>
                <div className="bg-black/20 rounded-lg p-3">
                  <div className="text-gray-400">Representative</div>
                  <div className="text-white font-bold text-xs">{clientRepresentative || 'Not Set'}</div>
                </div>
                <div className="bg-black/20 rounded-lg p-3">
                  <div className="text-gray-400">Date</div>
                  <div className="text-white font-bold">{new Date(signatureDate).toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Document Footer */}
          <div className="mt-12 border-t border-gray-700 pt-6">
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-xl p-6">
              <div className="text-center text-sm text-gray-400 space-y-2">
                <p><strong>Document Classification:</strong> {limitationsData.metadata.classification}</p>
                <p><strong>Version:</strong> {limitationsData.metadata.version} | <strong>Last Updated:</strong> {limitationsData.metadata.lastUpdated}</p>
                <p><strong>Generated:</strong> {new Date().toLocaleString()} | <strong>Applied to:</strong> {radarName}</p>
                <p className="text-xs text-gray-500 mt-4">
                  This document outlines the technical limitations of radar monitoring systems and requires client acknowledgement for operational compliance.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          
          body, html {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
            font-size: 11px !important;
          }
          
          * {
            background: white !important;
            color: black !important;
            border-color: #ccc !important;
          }
          
          .bg-gradient-to-r {
            background: #f8f9fa !important;
          }
          
          .bg-black\/20 {
            background: #f5f5f5 !important;
          }
          
          .text-white {
            color: black !important;
          }
          
          .text-gray-300,
          .text-gray-400 {
            color: #666 !important;
          }
          
          .border-white\/10 {
            border-color: #ddd !important;
          }
          
          .rounded-2xl,
          .rounded-xl {
            border-radius: 8px !important;
          }
          
          h1, h2, h3 {
            color: black !important;
            font-weight: bold !important;
          }
          
          .grid {
            display: block !important;
          }
          
          .grid > * {
            display: block !important;
            margin-bottom: 8px !important;
          }
          
          svg {
            color: black !important;
          }
          
          input[type="checkbox"]:checked {
            background-color: #000 !important;
          }
        }
      `}</style>
    </>
  );
}