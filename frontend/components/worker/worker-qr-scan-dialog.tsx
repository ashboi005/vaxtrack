import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Html5QrcodeScanner, Html5QrcodeScanType } from 'html5-qrcode';
import useUser from "@/hooks/useUser";
import { workerApi } from "@/services/worker";

interface WorkerQRScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanComplete?: () => void;
  userId?: string;
  driveId?: string;
}

const fadeVariants = {
  hidden: { opacity: 0 },
  visible: { 
    opacity: 1,
    transition: { duration: 0.3 }
  },
  exit: { 
    opacity: 0,
    transition: { duration: 0.2 }
  }
};

const formItemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (custom: number) => ({
    opacity: 1,
    y: 0,
    transition: { 
      delay: custom * 0.1,
      duration: 0.3
    }
  })
};

export function WorkerQRScanDialog({ open, onOpenChange, onScanComplete, userId, driveId }: WorkerQRScanDialogProps) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const { user } = useUser();
  
  // QR scanner references
  const qrScannerRef = useRef<Html5QrcodeScanner | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  
  // QR data state
  const [qrData, setQrData] = useState<{
    user_id?: string;
    drive_id?: string;
  } | null>(userId && driveId ? { user_id: userId, drive_id: driveId } : null);
  
  // Start QR scanner
  const startQRScanner = () => {
    setScanning(true);
    // Reset QR data when starting a new scan
    setQrData(null);
    console.log("Starting QR scanner");
  };
  
  // Stop and clean up scanner
  const stopScanner = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.clear().catch(error => {
        console.error("Failed to stop scanner:", error);
      });
      qrScannerRef.current = null;
    }
    setScanning(false);
    console.log("Stopping QR scanner");
  };
  
  // Parse QR content to extract user_id and drive_id
  const parseQRCode = (qrContent: string) => {
    try {
      console.log("Scanned QR content:", qrContent);
      
      // Clean up the input - normalize slashes, remove trailing slashes
      const cleanedContent = qrContent.trim().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
      console.log("Cleaned QR content:", cleanedContent);
      
      // Initialize extracted data object
      let extractedData: {
        user_id?: string;
        drive_id?: string;
      } = {};
      
      // Support Format: Direct path: worker/{user-id}/{drive-id}
      let pathPart = cleanedContent;
      
      // Extract user_id and drive_id from the path using regex
      const directPathRegex = /worker\/([^\/\s\?]+)\/([^\/\s\?]+)/i;
      const directMatch = pathPart.match(directPathRegex);
      
      if (directMatch && directMatch.length >= 3) {
        extractedData.user_id = directMatch[1];
        extractedData.drive_id = directMatch[2];
        
        console.log("Extracted QR data:", extractedData);
        setQrData(extractedData);
        return true;
      }
      
      console.log("QR Code parsed but no valid data found");
      toast.error("QR code format not recognized. Please scan a valid vaccination drive QR code in format worker/{user-id}/{drive-id}");
      return false;
    } catch (error) {
      console.error("Failed to parse QR code:", error);
      toast.error("Error processing QR code. Please try again.");
      return false;
    }
  };
  
  // State for user details
  const [userData, setUserData] = useState<{
    name?: string;
    age?: number;
    gender?: string;
  } | null>(null);

  // Fetch user details when QR data is available
  useEffect(() => {
    if (qrData && qrData.user_id && qrData.drive_id) {
      const fetchUserData = async () => {
        try {
          const data = await workerApi.getUserByQR(qrData.user_id!, qrData.drive_id!);
          setUserData(data);
        } catch (error) {
          console.error("Error fetching user data:", error);
        }
      };
      
      fetchUserData();
    }
  }, [qrData]);

  // Handle form submission
  const handleSubmit = async () => {
    if (!qrData || !qrData.user_id || !qrData.drive_id) {
      toast.error("Invalid QR code data");
      return;
    }
    
    setLoading(true);
    
    try {
      // Call API to administer the vaccine
      await workerApi.administerDriveVaccine(qrData.drive_id, {
        user_id: qrData.user_id,
        vaccination_date: new Date().toISOString(), // Full ISO format with T separator
        notes: notes
      });
      
      toast.success("Vaccination recorded successfully");
      if (onScanComplete) {
        onScanComplete();
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Error recording vaccination:", error);
      toast.error("Failed to record vaccination. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Setup QR scanner when scanning is enabled
  useEffect(() => {
    if (scanning && open) {
      const onScanSuccess = (decodedText: string) => {
        console.log("Scan success:", decodedText);
        // Play a success sound
        const audio = new Audio("/scan-success.mp3");
        audio.volume = 0.5;
        audio.play().catch(err => console.log("Audio play error:", err));
        
        // Stop scanning
        stopScanner();
        
        // Parse the QR code
        const isValid = parseQRCode(decodedText);
        
        if (!isValid) {
          // If invalid, re-enable scanning after a delay
          setTimeout(() => {
            startQRScanner();
          }, 2000);
        }
      };

      const onScanFailure = (error: string) => {
        // Just log the error, don't show it to the user
        console.warn(`QR scan error: ${error}`);
      };

      // Wait for DOM to be ready
      setTimeout(() => {
        const container = document.getElementById("worker-qr-scanner-container");
        if (container && !qrScannerRef.current) {
          // Configure scanner with improved settings
          qrScannerRef.current = new Html5QrcodeScanner(
            "worker-qr-scanner-container",
            {
              fps: 15, // Increased FPS for better responsiveness
              qrbox: { width: 300, height: 300 }, // Larger scanning area
              supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
              rememberLastUsedCamera: true,
              showTorchButtonIfSupported: true, // Add flashlight support if available
              aspectRatio: 1.0, // Square aspect ratio
              formatsToSupport: [ // Explicitly support common QR code formats
                0, // QR_CODE
                12 // AZTEC (fallback support)
              ]
            },
            false
          );
          
          qrScannerRef.current.render(onScanSuccess, onScanFailure);
          
          // Add a listener for when the camera becomes ready
          document.addEventListener('camera-ready', () => {
            console.log("Camera initialized successfully");
          });
        }
      }, 500);
    }
    
    return () => {
      if (scanning) {
        stopScanner();
      }
    };
  }, [scanning, open]);

  // Clean up scanner on unmount
  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  return (
    <Dialog 
      open={open} 
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen && scanning) {
          stopScanner();
        }
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="sm:max-w-md bg-[#141414] border-0 text-white shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold text-white">Scan Vaccination QR Code</DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-col gap-4">
          <AnimatePresence mode="wait">
            {!qrData ? (
              scanning ? (
                <motion.div
                  key="scanning"
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={fadeVariants}
                  className="flex flex-col items-center gap-4"
                >
                  <div className="w-full rounded-xl overflow-hidden bg-[#1c1c1c] border border-[#222] shadow-md relative">
                    {/* Animated scanning overlay */}
                    <div className="absolute inset-0 pointer-events-none z-10">
                      <div className="w-full h-1 bg-[#8ed500] opacity-70 absolute top-0 animate-[scan_2s_ease-in-out_infinite]"></div>
                    </div>
                    
                    {/* Scanner container */}
                    <div
                      id="worker-qr-scanner-container"
                      ref={scannerContainerRef}
                      className="w-full h-[320px]"
                    ></div>
                  </div>
                  
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-gray-300">
                      Position QR code in the center
                    </p>
                    <p className="text-xs text-gray-400">
                      Hold steady and ensure good lighting
                    </p>
                  </div>
                  
                  <style jsx global>{`
                    @keyframes scan {
                      0% { transform: translateY(0); }
                      50% { transform: translateY(320px); }
                      100% { transform: translateY(0); }
                    }
                    
                    /* Improve HTML5 QR Scanner UI */
                    #worker-qr-scanner-container video {
                      object-fit: cover !important;
                      border-radius: 4px;
                    }
                    
                    #worker-qr-scanner-container img {
                      display: none !important;
                    }
                    
                    #worker-qr-scanner-container div:has(select) {
                      margin-bottom: 10px !important;
                    }
                    
                    #worker-qr-scanner-container select {
                      border-radius: 4px !important;
                      padding: 4px 8px !important;
                      font-size: 14px !important;
                      background-color: #1c1c1c !important;
                      color: white !important;
                      border: 1px solid #333 !important;
                    }
                  `}</style>
                  
                  <motion.div
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Button 
                      onClick={stopScanner}
                      variant="outline"
                      className="w-full border-[#8ed500] text-[#8ed500] hover:bg-[#8ed500]/10"
                    >
                      Cancel Scan
                    </Button>
                  </motion.div>
                </motion.div>
              ) : (
                <motion.div
                  key="start-scan"
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={fadeVariants}
                  className="flex flex-col items-center gap-6 py-6"
                >
                  <div className="rounded-full bg-[#8ed500]/10 p-6">
                    <svg 
                      className="w-16 h-16 text-[#8ed500]" 
                      xmlns="http://www.w3.org/2000/svg" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M12 4v1m6 11h2m-6 0h-2m0 0v7m0-7h-6m6 0l-4-4m0 0l4-4m-4 4h12" 
                      />
                    </svg>
                  </div>
                  <div className="text-center space-y-2 max-w-xs">
                    <h3 className="text-lg font-semibold text-white">Scan Vaccination QR Code</h3>
                    <p className="text-sm text-gray-400">
                      Scan a QR code in format: worker/&#123;user-id&#125;/&#123;drive-id&#125;
                    </p>
                  </div>
                  
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-full"
                  >
                    <Button 
                      onClick={startQRScanner}
                      className="w-full bg-[#8ed500] text-[#141414] hover:bg-white py-6 transition-all duration-300"
                    >
                      <svg 
                        className="w-5 h-5 mr-2" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24" 
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={2} 
                          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" 
                        />
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={2} 
                          d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" 
                        />
                      </svg>
                      Start Camera
                    </Button>
                  </motion.div>
                </motion.div>
              )
            ) : (
              <motion.div
                key="qr-data"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={fadeVariants}
                className="space-y-4 pt-2"
              >             
                <motion.div 
                  variants={formItemVariants} 
                  custom={0}
                  className="bg-[#1c1c1c] rounded-lg p-4 mb-4"
                >
                  <p className="text-sm font-medium text-[#8ed500]">
                    QR Code detected in format worker/&#123;user-id&#125;/&#123;drive-id&#125;! Please verify the details below.
                  </p>
                </motion.div>
                
                {userData && (
                  <motion.div 
                    variants={formItemVariants} 
                    custom={1}
                    className="bg-[#8ed500]/10 border border-[#8ed500]/20 rounded-lg p-4 mb-4"
                  >
                    <h3 className="font-medium text-[#8ed500]">Patient Information</h3>
                    <div className="mt-2 text-sm text-gray-300">
                      <p><span className="font-medium text-white">Name:</span> {userData.name || 'Not available'}</p>
                      {userData.age && <p><span className="font-medium text-white">Age:</span> {userData.age} years</p>}
                      {userData.gender && <p><span className="font-medium text-white">Gender:</span> {userData.gender}</p>}
                    </div>
                  </motion.div>
                )}
            
                <motion.div variants={formItemVariants} custom={2} className="space-y-2">
                  <Label htmlFor="patient-id" className="text-gray-300">User ID</Label>
                  <Input 
                    id="patient-id" 
                    value={qrData.user_id} 
                    readOnly 
                    className="bg-[#1c1c1c] border-[#333] text-white"
                  />
                </motion.div>
                
                <motion.div variants={formItemVariants} custom={3} className="space-y-2">
                  <Label htmlFor="drive-id" className="text-gray-300">Drive ID</Label>
                  <Input 
                    id="drive-id" 
                    value={qrData.drive_id} 
                    readOnly 
                    className="bg-[#1c1c1c] border-[#333] text-white"
                  />
                </motion.div>
                
                <motion.div variants={formItemVariants} custom={4} className="space-y-2">
                  <Label htmlFor="vaccination-date" className="text-gray-300">Vaccination Date</Label>
                  <Input 
                    id="vaccination-date" 
                    value={new Date().toLocaleDateString()} 
                    readOnly 
                    className="bg-[#1c1c1c] border-[#333] text-white"
                  />
                </motion.div>
                
                <motion.div variants={formItemVariants} custom={5} className="space-y-2">
                  <Label htmlFor="notes" className="text-gray-300">Notes</Label>
                  <Textarea 
                    id="notes"
                    placeholder="Optional notes about this vaccination"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="min-h-[80px] bg-[#1c1c1c] border-[#333] text-white"
                  />
                </motion.div>
                
                <motion.div 
                  variants={formItemVariants} 
                  custom={6}
                  className="flex gap-3 justify-end pt-4"
                >
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setQrData(null);
                        startQRScanner();
                      }}
                      className="border-[#333] text-gray-300 hover:text-white hover:bg-[#333]"
                    >
                      Scan Again
                    </Button>
                  </motion.div>
                  
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                    <Button 
                      onClick={handleSubmit} 
                      disabled={loading}
                      className={`bg-[#8ed500] text-[#141414] hover:bg-white ${loading ? "opacity-70" : ""}`}
                    >
                      {loading ? (
                        <div className="flex items-center gap-2">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-[#141414]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <svg 
                            className="w-5 h-5" 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24" 
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span>Record Vaccination</span>
                        </div>
                      )}
                    </Button>
                  </motion.div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}